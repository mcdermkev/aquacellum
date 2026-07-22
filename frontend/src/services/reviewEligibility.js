/**
 * reviewEligibility.js
 *
 * The review-eligibility authorization boundary (Task 20, Tier A review
 * gate). Answers exactly one question — "may this actor leave a review on
 * this order right now?" — for every fulfillment method, including cash
 * (which moves no platform money but still carries full reputation
 * consequences per the plan's DOA Protection Policy).
 *
 * This module is intentionally tiny and paranoid: getting eligibility wrong
 * is a trust/fraud bug (fake reviews, review-bombing, or — worse — gating a
 * REQUIRED entitlement behind XP). It NEVER reads `xp`/`tier` from its
 * context, by design; `leave_review`/`view_reputation` are REQUIRED
 * entitlements in entitlements.js and must be available to a brand-new,
 * 0-XP account exactly as they are to a 10,000-XP account. Do not add an
 * XP/tier check here without an explicit Opus review.
 *
 * Composes (does not re-derive) the existing completed-order signal:
 *   - canonical states from marketplaceStateMachine.js (ORDER_STATES)
 *   - the legacy Dexie/`orders` completed-status set from breederDashboard.js
 *     (AVAILABLE_STATUSES) — the same list the seller-earnings dashboard
 *     treats as "money available" for the exact same underlying rows.
 *
 * Pure, deterministic, no network.
 */

import { ORDER_STATES, FULFILLMENT_METHODS } from "./marketplaceStateMachine.js";
import { AVAILABLE_STATUSES } from "./breederDashboard.js";

const S = ORDER_STATES;
const M = FULFILLMENT_METHODS;

// ─── Verified-fulfillment signal ────────────────────────────────────────────
//
// Canonical states that represent a verified, reviewable purchase. This
// includes PARTIALLY_RESOLVED deliberately (§3 key case): a mixed-outcome
// DOA resolution where some fish were refunded/replaced but the healthy
// siblings already transferred independently is still a real, completed
// purchase experience worth reviewing. CLAIM_OPEN (unresolved), REFUNDED
// (fully refunded — no verified purchase occurred), CANCELLED, and
// RECONCILIATION are all deliberately excluded.
const VERIFIED_CANONICAL_STATES = Object.freeze([
  S.HANDOFF_CONFIRMED,
  S.CERTIFICATE_TRANSFERRED,
  S.SELLER_PAID,
  S.COMPLETED,
  S.PARTIALLY_RESOLVED,
]);

function lc(v) {
  return typeof v === "string" ? v.toLowerCase() : v;
}

/**
 * Whether an order's fulfillment has reached a verified/completed state,
 * checking the canonical state first (preferred — carries the partial-DOA
 * nuance) and falling back to the legacy status set for rows that only
 * carry the older Dexie/cloud `orders.status` string.
 *
 * @param {{ canonicalState?: string, legacyStatus?: string }} order
 * @returns {boolean}
 */
function isVerifiedFulfillment(order) {
  if (order.canonicalState) {
    return VERIFIED_CANONICAL_STATES.includes(order.canonicalState);
  }
  if (order.legacyStatus) {
    return AVAILABLE_STATUSES.includes(order.legacyStatus);
  }
  return false;
}

/**
 * Decide whether a viewer may leave a review on an order right now.
 *
 * NEVER reads ctx.xp or ctx.tier — leaving a review is a REQUIRED
 * entitlement (entitlements.js `leave_review`) and must be identical for
 * every account regardless of XP.
 *
 * @param {Object} order
 * @param {string} order.buyerWallet - the order's buyer (any case)
 * @param {string} [order.sellerWallet]
 * @param {string} [order.canonicalState] - a marketplaceStateMachine.ORDER_STATES value
 * @param {string} [order.legacyStatus] - a legacy Dexie/cloud `orders.status` value,
 *   consulted only when canonicalState is absent
 * @param {Object} ctx
 * @param {string} ctx.viewerWallet - the authenticated caller's wallet
 * @param {Object|null} [ctx.existingReview] - a review already on file for
 *   this order, if any (the one-per-order backstop)
 * @returns {{ eligible: boolean, reason: string }}
 */
export function isOrderReviewable(order = {}, ctx = {}) {
  const viewerWallet = lc(ctx.viewerWallet);
  const buyerWallet = lc(order.buyerWallet);

  if (!viewerWallet || !buyerWallet || viewerWallet !== buyerWallet) {
    return { eligible: false, reason: "only the buyer of this order may leave a review" };
  }

  if (ctx.existingReview) {
    return { eligible: false, reason: "a review already exists for this order" };
  }

  if (!isVerifiedFulfillment(order)) {
    return { eligible: false, reason: "this order has not reached a verified completed state yet" };
  }

  return { eligible: true, reason: "eligible" };
}

// ─── Applicable rating dimensions ───────────────────────────────────────────

export const RATING_DIMENSIONS = Object.freeze([
  "health",
  "accuracy",
  "packaging",
  "communication",
  "fulfillment",
]);

// Packaging (bag/box/thermal-pack condition) only applies when the seller
// actually packed and shipped/courier-delivered the order. Prepaid and cash
// pickups hand the fish over in person — there's no packaging to rate.
const PICKUP_METHODS = Object.freeze([M.PREPAID_PICKUP, M.CASH_PICKUP]);

/**
 * Which structured sub-ratings apply for a given fulfillment method. Pure
 * lookup — health/accuracy/communication/fulfillment apply everywhere;
 * packaging is omitted for pickup methods.
 * @param {string} method - a FULFILLMENT_METHODS value
 * @returns {string[]}
 */
export function applicableRatingDimensions(method) {
  if (PICKUP_METHODS.includes(method)) {
    return RATING_DIMENSIONS.filter((d) => d !== "packaging");
  }
  return [...RATING_DIMENSIONS];
}

// ─── Seller response eligibility ────────────────────────────────────────────

/**
 * Whether a viewer may add a seller response to a review — the review's own
 * seller, exactly once.
 * @param {{ sellerWallet: string, sellerResponse?: (string|null) }} review
 * @param {{ viewerWallet: string }} ctx
 * @returns {boolean}
 */
export function canRespondToReview(review = {}, ctx = {}) {
  const viewerWallet = lc(ctx.viewerWallet);
  const sellerWallet = lc(review.sellerWallet);
  if (!viewerWallet || !sellerWallet || viewerWallet !== sellerWallet) return false;
  return !review.sellerResponse;
}
