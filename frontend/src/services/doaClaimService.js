/**
 * doaClaimService.js
 *
 * The server-side application service that persists the pure doaClaims core
 * (Task 17). It composes the DOA workflow with the authorization boundary
 * (Task 3) and the canonical store so opening and resolving a dead-on-arrival
 * claim is one authorized, auditable operation instead of scattered writes.
 *
 * A DOA claim spans several tables, and this service owns the ordering of those
 * writes so the invariants in MARKETPLACE_STATE_MODEL.md §5.5 hold:
 *   - opening a claim freezes automatic release (order.has_open_claim = true,
 *     order → claim_open), and marks the affected line items doa_claimed;
 *   - resolving applies per-line outcomes — refunds append ledger entries,
 *     replacements spawn a linked replacement sub-order and link it to the line
 *     item, denials pass the item through to completion — clears the freeze,
 *     and rolls the order up to refunded / partially_resolved / handoff_confirmed.
 *
 * Dependency-injected by design (see the store port below); the Supabase
 * implementation is api/_lib/supabaseDoaClaimStore.js and tests use an
 * in-memory fake, so this is fully unit-testable without a database.
 *
 * Store port (all async):
 *   getOrder(orderId)                         → order | null
 *   getLineItems(orderId)                     → [{ lineItemId, priceCents, state, ... }]
 *   getClaim(claimId)                         → claim | null
 *   getOpenClaimForOrder(orderId)             → claim | null
 *   createClaim(claim)                        → { ok, error? }  (unique: one open/order)
 *   resolveClaimRow(claimId, { status, resolutions, resolvedAtMs }) → void
 *   setLineItemStates([{ lineItemId, state, replacementSubOrderId? }])  → void
 *   appendLedgerEntries(orderId, entries)     → void  (idempotent per (type,id))
 *   createReplacementSubOrder(subOrder)       → subOrderId
 *   setOrderState(orderId, state, patch?)     → void
 *   recordTransition(row)                     → void  (unique on (orderId, key))
 */

import { openClaim as openClaimCore, resolveClaim as resolveClaimCore, CLAIM_STATUS } from "./doaClaims.js";
import { authorizeTransition } from "./orderAuthorization.js";
import { ORDER_STATES, LINE_ITEM_STATES } from "./marketplaceStateMachine.js";

/**
 * Open a DOA claim on an order and persist the freeze.
 *
 * @param {Object} params
 * @param {Object} params.store
 * @param {string} params.orderId
 * @param {string[]} params.affectedLineItemIds
 * @param {Object} params.evidence - { photos:[], description, ... }
 * @param {Object} params.actor - authenticated caller (normally the buyer)
 * @param {number} params.now - epoch ms
 * @param {string} [params.claimId]
 * @returns {Promise<{ ok:boolean, error?:string, claim?:Object }>}
 */
export async function openClaim({ store, orderId, affectedLineItemIds, evidence, actor, now, claimId }) {
  const order = await store.getOrder(orderId);
  if (!order) return { ok: false, error: "order not found" };

  // Authorization: only the buyer may open a claim, and only via a legal
  // state→claim_open edge for the order's fulfillment method.
  const authz = authorizeTransition(order, order.state, ORDER_STATES.CLAIM_OPEN, actor);
  if (!authz.allowed) return { ok: false, error: authz.reason };

  const lineItems = await store.getLineItems(orderId);
  const orderLineItemIds = lineItems.map((li) => li.lineItemId);

  // Pure decision: window eligibility + evidence + affected-item validity.
  const result = openClaimCore({
    order,
    orderLineItemIds,
    affectedLineItemIds,
    evidence,
    now,
    id: claimId,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // Persist: create the claim first so the one-open-claim-per-order unique
  // index is the guard against a concurrent duplicate.
  const created = await store.createClaim(result.claim);
  if (!created.ok) return { ok: false, error: created.error };

  await store.setLineItemStates(result.lineItemUpdates);
  await store.setOrderState(orderId, result.orderState, { has_open_claim: true });
  await store.recordTransition({
    orderId,
    fromState: order.state,
    toState: result.orderState,
    actorRole: authz.role,
    actorId: actorIdentity(actor),
    idempotencyKey: `${result.claim.id}:open`,
    reason: "DOA claim opened",
  });

  return { ok: true, claim: result.claim };
}

/**
 * Resolve an open DOA claim with per-line-item outcomes and persist every
 * consequence (ledger entries, line-item states, replacement sub-orders, claim
 * status, order rollup, and the release-freeze clear).
 *
 * @param {Object} params
 * @param {Object} params.store
 * @param {string} params.claimId
 * @param {Object<string,{ outcome:string, refundCents?:number, sellerPortionCents?:number }>} params.resolutions
 * @param {Object} params.actor - authenticated caller (curator, or system for auto full refund)
 * @param {number} params.now - epoch ms
 * @returns {Promise<{ ok:boolean, error?:string, claimStatus?:string, orderState?:string, replacementSubOrderIds?:string[] }>}
 */
export async function resolveClaim({ store, claimId, resolutions, actor, now }) {
  const claim = await store.getClaim(claimId);
  if (!claim) return { ok: false, error: "claim not found" };
  if (claim.status !== CLAIM_STATUS.OPEN) return { ok: false, error: "claim is not open" };

  const order = await store.getOrder(claim.orderId);
  if (!order) return { ok: false, error: "order not found" };

  const lineItems = await store.getLineItems(claim.orderId);
  const orderLineItems = lineItems.map((li) => ({
    lineItemId: li.lineItemId,
    priceCents: li.priceCents,
    // Per-line seller proceeds are not stored per item; the resolver supplies
    // explicit amounts. Fallback is 0 (the core treats it as such).
    sellerProceedsCents: li.sellerProceedsCents,
  }));

  // Pure decision.
  const result = resolveClaimCore({ claim, order, orderLineItems, resolutions, now });
  if (!result.ok) return { ok: false, error: result.error };

  // Authorization: the resulting order rollup must be a legal, permitted edge
  // out of claim_open for this actor (curator adjudicates; system auto-approves
  // full refunds).
  const authz = authorizeTransition(order, ORDER_STATES.CLAIM_OPEN, result.orderState, actor);
  if (!authz.allowed) return { ok: false, error: authz.reason };

  // Create replacement sub-orders first, then link each back to its line item.
  const replacementSubOrderIds = [];
  const subOrderIdByLineItem = {};
  for (const sub of result.replacementSubOrders) {
    const subOrderId = await store.createReplacementSubOrder(sub);
    replacementSubOrderIds.push(subOrderId);
    subOrderIdByLineItem[sub.replacesLineItemId] = subOrderId;
  }

  // Append money events (refunds) — idempotent per (order, type, entry id).
  if (result.ledgerEntries.length > 0) {
    await store.appendLedgerEntries(claim.orderId, result.ledgerEntries);
  }

  // Line-item states, carrying the replacement sub-order link where applicable.
  const lineItemUpdates = result.lineItemUpdates.map((u) =>
    subOrderIdByLineItem[u.lineItemId]
      ? { ...u, replacementSubOrderId: subOrderIdByLineItem[u.lineItemId] }
      : u,
  );
  // The core returns updates only for affected items. Resolution is also the
  // point at which the unaffected siblings are adjudicated healthy — mark them
  // so their certificates can transfer independently (state model §4). Only
  // promote items still awaiting a verdict (pending); never overwrite a prior
  // terminal/known state.
  const affectedSet = new Set(claim.affectedLineItemIds);
  const healthyUpdates = lineItems
    .filter((li) => !affectedSet.has(li.lineItemId) && li.state === LINE_ITEM_STATES.PENDING)
    .map((li) => ({ lineItemId: li.lineItemId, state: LINE_ITEM_STATES.HEALTHY }));
  await store.setLineItemStates([...lineItemUpdates, ...healthyUpdates]);

  // Persist the resolution decisions on the claim for audit (with any sub-order links).
  const resolutionsRecord = {};
  for (const [lineItemId, res] of Object.entries(resolutions)) {
    resolutionsRecord[lineItemId] = subOrderIdByLineItem[lineItemId]
      ? { ...res, replacementSubOrderId: subOrderIdByLineItem[lineItemId] }
      : { ...res };
  }
  await store.resolveClaimRow(claimId, {
    status: result.claimStatus,
    resolutions: resolutionsRecord,
    resolvedAtMs: now,
  });

  // Clear the release freeze and roll the order up.
  await store.setOrderState(claim.orderId, result.orderState, { has_open_claim: false });
  await store.recordTransition({
    orderId: claim.orderId,
    fromState: ORDER_STATES.CLAIM_OPEN,
    toState: result.orderState,
    actorRole: authz.role,
    actorId: actorIdentity(actor),
    idempotencyKey: `${claimId}:resolve`,
    reason: "DOA claim resolved",
  });

  return {
    ok: true,
    claimStatus: result.claimStatus,
    orderState: result.orderState,
    replacementSubOrderIds,
  };
}

function actorIdentity(actor) {
  if (!actor) return null;
  if (actor.isSystem) return "system";
  if (actor.isCurator) return actor.userId || actor.walletAddress || "curator";
  return actor.userId || actor.walletAddress || null;
}
