/**
 * doaClaims.js
 *
 * Dead-on-arrival (DOA) claim workflow (Task 17, Tier A). A live-animal
 * marketplace lives or dies on how it handles arrivals that don't survive, so
 * this is trust-critical: structured evidence, a protected claim window, and
 * per-line-item resolution (refund, replacement, or denial) that composes with
 * the payment ledger (Task 4) and the canonical state machine (Task 1).
 *
 * Key rules (MARKETPLACE_STATE_MODEL.md §5.5):
 *   - A claim freezes automatic release (handled by the coordinator seeing an
 *     open claim); resolution is per line item.
 *   - Healthy line items complete and transfer independently of an affected
 *     sibling's claim.
 *   - A replacement is NOT a terminal flag — it is a linked replacement
 *     sub-order that runs its own fulfillment + certificate cycle.
 *
 * Pure and dependency-free.
 */

import { ORDER_STATES, LINE_ITEM_STATES } from "./marketplaceStateMachine.js";
import { LEDGER_ENTRY_TYPES } from "./paymentLedger.js";

// ─── Policy constants ────────────────────────────────────────────────────────

// Platform-minimum claim window from verified delivery. Sellers may offer more,
// never less (enforced by taking the max with the seller's policy).
export const DEFAULT_CLAIM_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h
// Seller has this long to respond before the claim escalates to curator review.
export const DEFAULT_SELLER_RESPONSE_MS = 24 * 60 * 60 * 1000; // 24h

export const EVIDENCE_REQUIREMENTS = Object.freeze({ minPhotos: 2, requireDescription: true });

export const CLAIM_STATUS = Object.freeze({
  OPEN: "open",
  RESOLVED: "resolved", // fully or partially resolved (per-line detail carries specifics)
  DENIED: "denied", // all affected items denied after review
  EXPIRED: "expired",
});

export const RESOLUTION_OUTCOME = Object.freeze({
  REFUND: "refund",
  REPLACE: "replace",
  DENY: "deny",
});

const ELIGIBLE_CLAIM_STATES = [ORDER_STATES.DELIVERED, ORDER_STATES.REVIEW_WINDOW, ORDER_STATES.NON_DELIVERY];

// ─── Evidence ────────────────────────────────────────────────────────────────

/**
 * Validate claim evidence against the platform minimum.
 * @param {{ photos?: string[], description?: string }} evidence
 * @returns {{ ok:boolean, missing:string[] }}
 */
export function validateEvidence(evidence = {}) {
  const missing = [];
  const photoCount = Array.isArray(evidence.photos) ? evidence.photos.length : 0;
  if (photoCount < EVIDENCE_REQUIREMENTS.minPhotos) {
    missing.push(`at least ${EVIDENCE_REQUIREMENTS.minPhotos} photos (${photoCount} provided)`);
  }
  if (EVIDENCE_REQUIREMENTS.requireDescription && !String(evidence.description || "").trim()) {
    missing.push("a description of the issue");
  }
  return { ok: missing.length === 0, missing };
}

// ─── Opening a claim ─────────────────────────────────────────────────────────

/**
 * The effective claim window is the larger of the platform minimum and the
 * seller's (checkout-snapshotted) policy — a seller can extend, never shorten.
 */
export function effectiveClaimWindowMs(sellerPolicyWindowMs) {
  const seller = Number(sellerPolicyWindowMs);
  return Number.isFinite(seller) && seller > DEFAULT_CLAIM_WINDOW_MS ? seller : DEFAULT_CLAIM_WINDOW_MS;
}

/**
 * Whether a buyer may open a claim right now.
 * @param {{ orderState:string, deliveredAt:number, now:number, sellerPolicyWindowMs?:number }} args
 * @returns {{ ok:boolean, reason?:string, deadlineAt?:number }}
 */
export function canOpenClaim({ orderState, deliveredAt, now, sellerPolicyWindowMs }) {
  if (!ELIGIBLE_CLAIM_STATES.includes(orderState)) {
    return { ok: false, reason: `order state ${orderState} is not claim-eligible` };
  }
  const windowMs = effectiveClaimWindowMs(sellerPolicyWindowMs);
  const deadlineAt = Number(deliveredAt) + windowMs;
  if (Number(now) > deadlineAt) {
    return { ok: false, reason: "claim window has closed", deadlineAt };
  }
  return { ok: true, deadlineAt };
}

/**
 * Open a DOA claim on a set of affected line items.
 *
 * @param {Object} args
 * @param {Object} args.order - { id, state, deliveredAt, sellerPolicyWindowMs? }
 * @param {string[]} args.orderLineItemIds - all line item ids on the order
 * @param {string[]} args.affectedLineItemIds - the items being claimed
 * @param {Object} args.evidence
 * @param {number} args.now
 * @param {string} [args.id] - claim id
 * @returns {{ ok:boolean, error?:string, claim?:Object, lineItemUpdates?:Array, orderState?:string }}
 */
export function openClaim({ order, orderLineItemIds, affectedLineItemIds, evidence, now, id }) {
  const gate = canOpenClaim({ orderState: order.state, deliveredAt: order.deliveredAt, now, sellerPolicyWindowMs: order.sellerPolicyWindowMs });
  if (!gate.ok) return { ok: false, error: gate.reason };

  const ev = validateEvidence(evidence);
  if (!ev.ok) return { ok: false, error: `incomplete evidence: ${ev.missing.join("; ")}` };

  const affected = [...new Set(affectedLineItemIds || [])];
  if (affected.length === 0) return { ok: false, error: "no affected line items specified" };
  const unknown = affected.filter((li) => !orderLineItemIds.includes(li));
  if (unknown.length > 0) return { ok: false, error: `unknown line items: ${unknown.join(", ")}` };

  const claim = {
    id: id || `claim_${order.id}_${now}`,
    orderId: order.id,
    status: CLAIM_STATUS.OPEN,
    affectedLineItemIds: affected,
    evidence,
    openedAt: now,
    sellerResponseDeadlineAt: now + DEFAULT_SELLER_RESPONSE_MS,
    deadlineAt: gate.deadlineAt,
  };
  const lineItemUpdates = affected.map((li) => ({ lineItemId: li, state: LINE_ITEM_STATES.DOA_CLAIMED }));

  return { ok: true, claim, lineItemUpdates, orderState: ORDER_STATES.CLAIM_OPEN };
}

// ─── Resolving a claim ───────────────────────────────────────────────────────

/**
 * Apply per-line-item resolutions to an open claim. Produces the ledger entries
 * to append, any replacement sub-orders to create, the per-line-item state
 * updates, and the resulting canonical order state.
 *
 * @param {Object} args
 * @param {Object} args.claim - the open claim
 * @param {Object} args.order - { id, method, buyerWallet, sellerWallet }
 * @param {Array<{ lineItemId:string, priceCents:number, sellerProceedsCents:number }>} args.orderLineItems - ALL line items
 * @param {Object<string,{ outcome:string, refundCents?:number, sellerPortionCents?:number }>} args.resolutions - keyed by affected lineItemId
 * @param {number} args.now
 * @returns {{
 *   ok:boolean, error?:string, claimStatus?:string,
 *   ledgerEntries?:Array, replacementSubOrders?:Array, lineItemUpdates?:Array, orderState?:string
 * }}
 */
export function resolveClaim({ claim, order, orderLineItems, resolutions, now }) {
  if (!claim || claim.status !== CLAIM_STATUS.OPEN) {
    return { ok: false, error: "claim is not open" };
  }
  // Every affected item must have a resolution.
  const missing = claim.affectedLineItemIds.filter((li) => !resolutions || !resolutions[li]);
  if (missing.length > 0) return { ok: false, error: `missing resolutions for: ${missing.join(", ")}` };

  const byId = Object.fromEntries(orderLineItems.map((li) => [li.lineItemId, li]));
  const ledgerEntries = [];
  const replacementSubOrders = [];
  const lineItemUpdates = [];
  const finalStateByLine = {};

  // Healthy (unaffected) items proceed independently.
  for (const li of orderLineItems) {
    if (!claim.affectedLineItemIds.includes(li.lineItemId)) {
      finalStateByLine[li.lineItemId] = LINE_ITEM_STATES.HEALTHY;
    }
  }

  for (const lineItemId of claim.affectedLineItemIds) {
    const res = resolutions[lineItemId];
    const line = byId[lineItemId] || { priceCents: 0, sellerProceedsCents: 0 };
    switch (res.outcome) {
      case RESOLUTION_OUTCOME.REFUND: {
        const refundCents = res.refundCents != null ? Number(res.refundCents) : Number(line.priceCents || 0);
        const sellerPortionCents = res.sellerPortionCents != null ? Number(res.sellerPortionCents) : Number(line.sellerProceedsCents || 0);
        ledgerEntries.push({
          type: LEDGER_ENTRY_TYPES.REFUND,
          id: `${claim.id}:${lineItemId}:refund`,
          amountCents: refundCents,
          sellerPortionCents,
        });
        finalStateByLine[lineItemId] = LINE_ITEM_STATES.REFUNDED;
        lineItemUpdates.push({ lineItemId, state: LINE_ITEM_STATES.REFUNDED });
        break;
      }
      case RESOLUTION_OUTCOME.REPLACE: {
        replacementSubOrders.push({
          originalOrderId: order.id,
          replacesLineItemId: lineItemId,
          method: order.method,
          buyerWallet: order.buyerWallet,
          sellerWallet: order.sellerWallet,
          chargeCents: 0, // settled against the resolved claim; no new buyer charge
          note: "DOA replacement",
          createdAt: now,
        });
        finalStateByLine[lineItemId] = LINE_ITEM_STATES.REPLACEMENT_PENDING;
        lineItemUpdates.push({ lineItemId, state: LINE_ITEM_STATES.REPLACEMENT_PENDING });
        break;
      }
      case RESOLUTION_OUTCOME.DENY: {
        finalStateByLine[lineItemId] = LINE_ITEM_STATES.DENIED;
        lineItemUpdates.push({ lineItemId, state: LINE_ITEM_STATES.DENIED });
        break;
      }
      default:
        return { ok: false, error: `unknown resolution outcome for ${lineItemId}: ${res.outcome}` };
    }
  }

  // Roll up the resulting order state.
  const states = Object.values(finalStateByLine);
  const allRefunded = states.length > 0 && states.every((s) => s === LINE_ITEM_STATES.REFUNDED);
  const anyRefundOrReplace = states.some((s) => s === LINE_ITEM_STATES.REFUNDED || s === LINE_ITEM_STATES.REPLACEMENT_PENDING);

  let orderState;
  if (allRefunded) {
    orderState = ORDER_STATES.REFUNDED; // whole order refunded
  } else if (anyRefundOrReplace) {
    orderState = ORDER_STATES.PARTIALLY_RESOLVED; // mixed outcomes / healthy items remain
  } else {
    orderState = ORDER_STATES.HANDOFF_CONFIRMED; // only denials + healthy → proceed to completion
  }

  // Claim status: denied only if every affected item was denied; else resolved.
  const affectedFinal = claim.affectedLineItemIds.map((li) => finalStateByLine[li]);
  const claimStatus = affectedFinal.every((s) => s === LINE_ITEM_STATES.DENIED)
    ? CLAIM_STATUS.DENIED
    : CLAIM_STATUS.RESOLVED;

  return { ok: true, claimStatus, ledgerEntries, replacementSubOrders, lineItemUpdates, orderState };
}
