/**
 * canonicalDelivery.js — bridge that advances a canonical order through the
 * delivery lifecycle from real dispatch/delivery events (Task 16). Companion to
 * canonicalSettlement.js / canonicalReservations.js; used only by the
 * feature-flagged wiring in stripe.js (CANONICAL_SETTLEMENT_ENABLED).
 *
 * The canonical order is created at `payment_protected` by the Stripe webhook.
 * This module drives it the rest of the way for shipping/courier:
 *
 *   payment_protected → preparing → in_transit   (recordDispatch, at label buy)
 *   in_transit → delivered                        (recordDelivery, at ShipEngine DE event)
 *   in_transit → non_delivery                     (autoAdvance, max transit window elapsed)
 *   delivered → review_window → handoff_confirmed → settle
 *                                                 (autoAdvance, claim window elapsed, no claim)
 *
 * Every operation is idempotent (applyTransition dedupes on a per-order
 * idempotency key) and best-effort (a missing canonical order — e.g. the flag
 * was off at checkout — is a clean skip, never a throw). The `delivered` step
 * stamps `metadata.deliveredAtMs`, which is the anchor the DOA claim window and
 * the auto-complete deadline both read.
 */

import { applyTransition, runSettlement } from "../../src/services/orderService.js";
import { ORDER_STATES as S } from "../../src/services/marketplaceStateMachine.js";
import { evaluateAutoAdvance, AUTO_ADVANCE } from "../../src/services/deliveryLifecycle.js";

const SYSTEM = Object.freeze({ isSystem: true });

// States at or past `delivered` — used to short-circuit an already-delivered
// order so a duplicate delivery webhook is a no-op.
const DELIVERED_OR_BEYOND = [
  S.DELIVERED, S.REVIEW_WINDOW, S.HANDOFF_CONFIRMED,
  S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED,
];

/**
 * Record dispatch: stamp the tracking number + dispatch time on the canonical
 * order and advance payment_protected → preparing → in_transit. Called from the
 * in-app label purchase (handleShipLabel). Idempotent; a re-dispatch only
 * ensures the tracking number is present.
 *
 * @param {Object} args
 * @param {Object} args.store - supabaseOrderStore
 * @param {string} args.paymentIntentId
 * @param {string} [args.trackingNumber]
 * @param {number} [args.dispatchedAtMs] - defaults to now
 * @returns {Promise<{ ok:boolean, skipped?:boolean, state?:string, error?:string }>}
 */
export async function recordDispatch({ store, paymentIntentId, trackingNumber, dispatchedAtMs }) {
  const order = await store.getOrderByPaymentIntent(paymentIntentId);
  if (!order) return { ok: false, skipped: true, error: "no canonical order for payment" };

  const now = dispatchedAtMs || Date.now();
  // Ensure the tracking number is stamped (delivery webhooks resolve by it);
  // only set dispatchedAtMs the first time so re-dispatch doesn't reset the
  // transit-window anchor.
  const metaPatch = {};
  if (trackingNumber && order.trackingNumber !== String(trackingNumber)) metaPatch.trackingNumber = String(trackingNumber);
  if (order.dispatchedAt == null) metaPatch.dispatchedAtMs = now;
  if (Object.keys(metaPatch).length > 0) {
    await store.patchOrderMetadata(order.id, metaPatch);
  }

  // Two-hop advance; each is idempotent and no-ops if the order is already past
  // that edge (illegal-edge results are expected on re-run and ignored).
  await applyTransition({ store, orderId: order.id, to: S.PREPARING, actor: SYSTEM, idempotencyKey: `${order.id}:preparing`, reason: "dispatch: preparing" });
  const res = await applyTransition({ store, orderId: order.id, to: S.IN_TRANSIT, actor: SYSTEM, idempotencyKey: `${order.id}:in_transit`, reason: "dispatch: in transit" });

  const after = await store.getOrder(order.id);
  return { ok: true, state: after?.state, transitioned: res.ok && !res.idempotent };
}

/**
 * Record a verified delivery event: stamp deliveredAtMs and advance
 * in_transit (or a late non_delivery) → delivered. Called from the ShipEngine
 * delivery webhook (statusCode DE). Resolves the order by tracking number,
 * falling back to the payment intent. Idempotent: an order already at/past
 * `delivered` is a no-op.
 *
 * @param {Object} args
 * @param {Object} args.store
 * @param {string} [args.trackingNumber]
 * @param {string} [args.paymentIntentId]
 * @param {number} [args.deliveredAtMs] - defaults to now
 * @returns {Promise<{ ok:boolean, skipped?:boolean, idempotent?:boolean, state?:string, error?:string }>}
 */
export async function recordDelivery({ store, trackingNumber, paymentIntentId, deliveredAtMs }) {
  let order = trackingNumber ? await store.getOrderByTracking(trackingNumber) : null;
  if (!order && paymentIntentId) order = await store.getOrderByPaymentIntent(paymentIntentId);
  if (!order) return { ok: false, skipped: true, error: "no canonical order for delivery event" };

  // Already delivered or beyond → idempotent no-op (duplicate webhook).
  if (DELIVERED_OR_BEYOND.includes(order.state)) {
    return { ok: true, idempotent: true, state: order.state };
  }

  // Stamp the verified delivery timestamp (the claim-window anchor) once.
  if (order.deliveredAt == null) {
    await store.patchOrderMetadata(order.id, { deliveredAtMs: deliveredAtMs || Date.now() });
  }

  // in_transit → delivered, or a late event rejoining from non_delivery.
  const res = await applyTransition({
    store, orderId: order.id, to: S.DELIVERED, actor: SYSTEM,
    idempotencyKey: `${order.id}:delivered`, reason: "verified delivery event",
  });
  if (!res.ok) return { ok: false, state: order.state, error: res.reason };
  return { ok: true, state: res.state };
}

/**
 * The delivery-gated auto-advance job (replaces handleAutoRelease's
 * DISPATCHED + 3 days heuristic). Scans in-flight orders and, per the pure
 * decision in evaluateAutoAdvance:
 *   - moves a transit-window-elapsed order with no delivery event to
 *     `non_delivery` (never auto-completes it), or
 *   - auto-completes a delivered order whose claim window elapsed with no
 *     claim: delivered → review_window → handoff_confirmed → settle.
 *
 * Settlement effects are injected via `buildEffectsForOrder(order)` so the job
 * stays testable (the live cron builds real chain+Stripe effects; the smoke
 * test injects mocks).
 *
 * @param {Object} args
 * @param {Object} args.store
 * @param {number} [args.now]
 * @param {(order:Object)=>Promise<{transferCertificate:Function, initiatePayout:Function}>} args.buildEffectsForOrder
 * @param {number} [args.limit]
 * @returns {Promise<{ scanned:number, nonDelivery:number, completed:number, skipped:number, failed:number, details:Array }>}
 */
export async function autoAdvanceDeliveryOrders({ store, now = Date.now(), buildEffectsForOrder, limit = 200 }) {
  const candidates = await store.listDeliveryCandidates(limit);
  const results = { scanned: 0, nonDelivery: 0, completed: 0, skipped: 0, failed: 0, details: [] };

  for (const order of candidates) {
    results.scanned++;
    const decision = evaluateAutoAdvance({
      state: order.state,
      method: order.method,
      dispatchedAt: order.dispatchedAt,
      deliveredAt: order.deliveredAt,
      now,
      hasOpenClaim: order.hasOpenClaim,
      sellerPolicyWindowMs: order.sellerPolicyWindowMs,
    });

    if (decision.action === AUTO_ADVANCE.NONE) {
      results.skipped++;
      continue;
    }

    try {
      if (decision.action === AUTO_ADVANCE.NON_DELIVERY) {
        const res = await applyTransition({
          store, orderId: order.id, to: S.NON_DELIVERY, actor: SYSTEM,
          idempotencyKey: `${order.id}:non_delivery`, reason: decision.reason,
        });
        if (res.ok) {
          results.nonDelivery++;
          results.details.push({ orderId: order.id, action: "non_delivery" });
        } else {
          results.failed++;
          results.details.push({ orderId: order.id, action: "non_delivery", error: res.reason });
        }
        continue;
      }

      if (decision.action === AUTO_ADVANCE.AUTO_COMPLETE) {
        // delivered → review_window → handoff_confirmed (both SYSTEM edges),
        // then run the atomic certificate→payout settlement.
        await applyTransition({ store, orderId: order.id, to: S.REVIEW_WINDOW, actor: SYSTEM, idempotencyKey: `${order.id}:review_window`, reason: "claim window elapsed" });
        const handoff = await applyTransition({ store, orderId: order.id, to: S.HANDOFF_CONFIRMED, actor: SYSTEM, idempotencyKey: `${order.id}:handoff_confirmed`, reason: "auto-complete: no claim" });

        const current = await store.getOrder(order.id);
        if (!current || current.state !== S.HANDOFF_CONFIRMED) {
          // Couldn't reach the settlement entry state — surface, don't settle.
          results.failed++;
          results.details.push({ orderId: order.id, action: "auto_complete", error: handoff.reason || `stuck at ${current?.state}` });
          continue;
        }

        const effects = await buildEffectsForOrder(current);
        const settle = await runSettlement({ store, orderId: order.id, actor: SYSTEM, effects });
        if (settle.ok) {
          results.completed++;
          results.details.push({ orderId: order.id, action: "auto_complete", finalState: settle.finalState });
        } else {
          results.failed++;
          results.details.push({ orderId: order.id, action: "auto_complete", settleAction: settle.action, error: settle.error });
        }
      }
    } catch (err) {
      results.failed++;
      results.details.push({ orderId: order.id, error: err?.message || "auto-advance threw" });
    }
  }

  return results;
}
