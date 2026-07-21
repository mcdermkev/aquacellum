/**
 * orderService.js
 *
 * The server-side application service that turns the four pure settlement cores
 * into persisted, idempotent order operations. It is the single place a request
 * handler calls to move an order or run settlement, so the ad-hoc transition
 * logic scattered across the serverless handlers converges here.
 *
 * Dependency-injected by design:
 *   - `store`   — a persistence port (see the "Store port" contract below).
 *                 The Supabase implementation lives in
 *                 api/_lib/supabaseOrderStore.js; tests use an in-memory fake.
 *   - `effects` — the certificate-transfer and payout side effects, injected
 *                 into settlement (chain + Stripe at the edge).
 *
 * Because the cores are pure and the I/O is injected, this module is fully unit
 * testable without a database, Stripe, or a chain.
 *
 * Store port (all async):
 *   getOrder(orderId)                        → canonical order | null
 *   getLedgerEntries(orderId)                → array of ledger entries
 *   findTransition(orderId, idempotencyKey)  → transition row | null
 *   appendLedgerEntries(orderId, entries)    → void   (idempotent per (type,id))
 *   setOrderState(orderId, state, patch?)    → void
 *   recordTransition(row)                    → void   (unique on (orderId, key))
 */

import { authorizeTransition } from "./orderAuthorization.js";
import { completeSettlement } from "./settlementCoordinator.js";

/**
 * Apply a single authorized, idempotent state transition to an order.
 *
 * @param {Object} params
 * @param {Object} params.store
 * @param {string} params.orderId
 * @param {string} params.to - target canonical state
 * @param {Object} params.actor - authenticated caller
 * @param {string} params.idempotencyKey - dedupes replays of this transition
 * @param {Array}  [params.entries] - ledger entries to append with this move
 * @param {string} [params.reason]
 * @returns {Promise<{ok:boolean, state?:string, idempotent?:boolean, reason?:string, role?:string}>}
 */
export async function applyTransition({ store, orderId, to, actor, idempotencyKey, entries = [], reason }) {
  const order = await store.getOrder(orderId);
  if (!order) return { ok: false, reason: "order not found" };

  // Idempotency: if this exact transition was already recorded, it's a no-op.
  if (idempotencyKey) {
    const prior = await store.findTransition(orderId, idempotencyKey);
    if (prior) {
      return { ok: true, idempotent: true, state: order.state };
    }
  }

  const authz = authorizeTransition(order, order.state, to, actor);
  if (!authz.allowed) {
    return { ok: false, reason: authz.reason };
  }

  const from = order.state;
  if (entries.length > 0) {
    await store.appendLedgerEntries(orderId, entries);
  }
  await store.setOrderState(orderId, to);
  await store.recordTransition({
    orderId,
    fromState: from,
    toState: to,
    actorRole: authz.role,
    actorId: actorIdentity(actor),
    idempotencyKey,
    reason,
  });

  return { ok: true, state: to, role: authz.role };
}

/**
 * Run the atomic completion sequence for an order and persist the result.
 * Loads the order + its ledger, delegates ordering/failure logic to the
 * settlement coordinator, then writes back the resulting state, appended ledger
 * entries, certificate reference, and a transition audit row.
 *
 * @param {Object} params
 * @param {Object} params.store
 * @param {string} params.orderId
 * @param {Object} params.actor - the platform automation ({ isSystem: true })
 * @param {Object} params.effects - { transferCertificate, initiatePayout }
 * @param {string} [params.idempotencyKey]
 * @returns {Promise<Object>} the coordinator result, plus { persisted:boolean }
 */
export async function runSettlement({ store, orderId, actor, effects, idempotencyKey }) {
  const order = await store.getOrder(orderId);
  if (!order) return { ok: false, action: "not_found", persisted: false };

  const ledgerEntries = await store.getLedgerEntries(orderId);
  const result = await completeSettlement({ order, actor, ledgerEntries, effects });

  // Persist whatever moved — even on the partial (payout-pending) path, the
  // certificate transfer and its ledger entries must be recorded so a retry
  // resumes correctly and never re-transfers the certificate.
  if (result.appendedEntries && result.appendedEntries.length > 0) {
    await store.appendLedgerEntries(orderId, result.appendedEntries);
  }
  if (result.finalState && result.finalState !== order.state) {
    const patch = result.certificateRef ? { certificate_ref: result.certificateRef } : undefined;
    await store.setOrderState(orderId, result.finalState, patch);
    await store.recordTransition({
      orderId,
      fromState: order.state,
      toState: result.finalState,
      actorRole: "system",
      actorId: actorIdentity(actor),
      idempotencyKey: idempotencyKey || `${orderId}:settle:${result.finalState}`,
      reason: result.action,
    });
  }

  return { ...result, persisted: true };
}

function actorIdentity(actor) {
  if (!actor) return null;
  if (actor.isSystem) return "system";
  return actor.userId || actor.walletAddress || null;
}
