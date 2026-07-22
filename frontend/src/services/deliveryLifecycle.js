/**
 * deliveryLifecycle.js
 *
 * Pure timing/decision logic for the delivery-gated release model (Task 16,
 * paired with the Task 5 auto-release rewrite). It answers one question for a
 * shipping/courier order:
 *
 *   "Given where this order is and how long it's been there, what should the
 *    automated job do next — nothing, mark it non-delivery, or auto-complete?"
 *
 * The two anchors (MARKETPLACE_STATE_MODEL.md §3/§5.1, and the plan's
 * "Delivery-gated release"):
 *   - A shipment that never produces a verified delivery event within its
 *     MAX transit window must NOT sit forever with the seller unpaid — it moves
 *     to `non_delivery` (buyer can then report never-received; escalates to
 *     reconciliation). It never auto-completes on elapsed time alone.
 *   - A delivered order auto-completes only after the buyer's claim window
 *     elapses with no open claim — anchored to the verified delivery timestamp,
 *     not time-since-dispatch (this replaces `handleAutoRelease`'s old
 *     DISPATCHED + 3 days heuristic).
 *
 * Pure and dependency-free besides the canonical enums and the DOA claim-window
 * policy (reused so the "when can the buyer still claim?" and "when may we
 * auto-complete?" deadlines are computed from a single source of truth).
 */

import { ORDER_STATES, FULFILLMENT_METHODS } from "./marketplaceStateMachine.js";
import { effectiveClaimWindowMs, DEFAULT_CLAIM_WINDOW_MS } from "./doaClaims.js";

const S = ORDER_STATES;
const M = FULFILLMENT_METHODS;

// ─── Max transit windows ─────────────────────────────────────────────────────
// The point past which a shipment with no verified delivery event is presumed
// lost/stuck and moved to `non_delivery`. Deliberately generous for nationwide
// shipping (slow/misscanned carriers must not trip a false non-delivery); tight
// for same-day local courier. A late delivery event after this still rejoins
// the normal `delivered` flow (non_delivery → delivered is a legal edge).
const DAY_MS = 24 * 60 * 60 * 1000;

export const MAX_TRANSIT_WINDOW_MS = Object.freeze({
  [M.SHIPPING]: 10 * DAY_MS,
  [M.COURIER]: 1 * DAY_MS,
});

/**
 * Max transit window for a fulfillment method, or null for methods that have no
 * transit phase (pickup/cash are settled in person and never sit in transit).
 * @param {string} method
 * @returns {number|null}
 */
export function maxTransitWindowMs(method) {
  return MAX_TRANSIT_WINDOW_MS[method] ?? null;
}

// ─── Auto-advance decision ───────────────────────────────────────────────────

export const AUTO_ADVANCE = Object.freeze({
  NONE: "none", // leave the order where it is
  NON_DELIVERY: "non_delivery", // in_transit → non_delivery (transit window elapsed, no delivery event)
  AUTO_COMPLETE: "auto_complete", // delivered/review_window → … → settle (claim window elapsed, no claim)
});

// Only these methods traverse a transit/claim window; pickup/cash never do.
const TRANSIT_METHODS = [M.SHIPPING, M.COURIER];

/**
 * Decide the automated next action for an order in the delivery phase.
 *
 * @param {Object} args
 * @param {string} args.state - current canonical ORDER_STATES value
 * @param {string} args.method - FULFILLMENT_METHODS value
 * @param {number|null} [args.dispatchedAt] - epoch ms the order entered transit
 * @param {number|null} [args.deliveredAt] - epoch ms of the verified delivery event
 * @param {number} args.now - epoch ms
 * @param {boolean} [args.hasOpenClaim] - a DOA claim/dispute freezes all auto-advance
 * @param {number} [args.sellerPolicyWindowMs] - seller's enhanced claim window (>= platform min)
 * @returns {{ action:string, reason:string, deadlineAt?:number }}
 */
export function evaluateAutoAdvance({ state, method, dispatchedAt, deliveredAt, now, hasOpenClaim = false, sellerPolicyWindowMs }) {
  // An open claim/dispute freezes automatic release entirely (§5.5).
  if (hasOpenClaim) {
    return { action: AUTO_ADVANCE.NONE, reason: "open claim freezes auto-advance" };
  }

  // Only shipping/courier have a transit + claim-window lifecycle.
  if (!TRANSIT_METHODS.includes(method)) {
    return { action: AUTO_ADVANCE.NONE, reason: `method ${method} has no transit/claim window` };
  }

  // In transit: presume non-delivery once the max transit window elapses with
  // no verified delivery event. Never auto-complete from here.
  if (state === S.IN_TRANSIT) {
    const maxMs = maxTransitWindowMs(method);
    if (maxMs == null || dispatchedAt == null) {
      return { action: AUTO_ADVANCE.NONE, reason: "no dispatch anchor for transit window" };
    }
    const deadlineAt = Number(dispatchedAt) + maxMs;
    if (Number(now) > deadlineAt) {
      return { action: AUTO_ADVANCE.NON_DELIVERY, reason: "max transit window elapsed with no delivery event", deadlineAt };
    }
    return { action: AUTO_ADVANCE.NONE, reason: "within transit window", deadlineAt };
  }

  // Delivered (or the silent-buyer review_window): auto-complete once the claim
  // window elapses from the VERIFIED delivery timestamp with no open claim.
  if (state === S.DELIVERED || state === S.REVIEW_WINDOW) {
    if (deliveredAt == null) {
      // Should not happen (delivered implies a delivery timestamp), but never
      // auto-complete without the anchor.
      return { action: AUTO_ADVANCE.NONE, reason: "no delivery anchor for claim window" };
    }
    const windowMs = effectiveClaimWindowMs(sellerPolicyWindowMs);
    const deadlineAt = Number(deliveredAt) + windowMs;
    if (Number(now) > deadlineAt) {
      return { action: AUTO_ADVANCE.AUTO_COMPLETE, reason: "claim window elapsed with no claim", deadlineAt };
    }
    return { action: AUTO_ADVANCE.NONE, reason: "within claim window", deadlineAt };
  }

  // non_delivery never auto-advances by time (§9): requires a delivery event or
  // operator reconciliation. Any other state is not our concern here.
  return { action: AUTO_ADVANCE.NONE, reason: `state ${state} is not auto-advanceable` };
}

export { DEFAULT_CLAIM_WINDOW_MS };
