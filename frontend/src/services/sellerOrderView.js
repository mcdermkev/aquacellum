/**
 * sellerOrderView.js
 *
 * Normalizes a raw local order record (Dexie `marketOrders` shipping/batch/
 * fiat_pending shapes, or an equivalent legacy-cloud `orders` row) into one
 * canonical-state-aware **seller** view model — the analog of
 * buyerOrderView.js for the fulfillment queue in BreederTerminal's Orders
 * section (Task 19). See docs/TASK_19_SELLER_OPS_SPEC.md §2.
 *
 * Method + canonical-state resolution is a property of the order, not the
 * viewer's role, so this module reuses buyerOrderView's `resolveMethod` /
 * `resolveCanonicalState` rather than forking them. Everything role-specific
 * (next action, payout bucket, customer alias, filters) lives here, kept
 * deliberately separate from buyerOrderView's buyer-centric `nextAction` so
 * neither contract gets muddied by a shared role flag (per spec §2).
 *
 * IMPORTANT: presentation normalization only — does not change the order
 * source of truth (Dexie/legacy `orders` via ordersSync.js / relayer.js).
 *
 * Pure and dependency-free (besides orderCopy/marketplaceStateMachine/
 * breederDashboard's money mapping/orderStatus/generateAlias).
 */

import { ORDER_STATES, FULFILLMENT_METHODS } from "./marketplaceStateMachine.js";
import { resolveMethod, resolveCanonicalState } from "./buyerOrderView.js";
import { orderStatusLabel, sellerNextActionCopy, SELLER_ACTION_KIND } from "./orderCopy.js";
import { sellerPayoutBucket, sellerProceedsCents as cloudSellerProceedsCents } from "./breederDashboard.js";
import { getLocalStatusString } from "./orderStatus.js";
import { generateAlias } from "../utils/generateAlias.js";

const S = ORDER_STATES;
const M = FULFILLMENT_METHODS;

// ─── Per-order proceeds (local/legacy shapes) ───────────────────────────────
//
// breederDashboard.sellerProceedsCents expects the cloud `orders` row shape
// (subtotal_cents/platform_fee_cents/total_paid_cents). Raw Dexie order
// records don't carry itemized fee columns at all, so there's nothing to
// "fork" here — this falls back to the same total-paid convention
// breederDashboard uses when those columns are absent, just reading the
// local field names (amountLocked / fiat items) instead of the cloud ones.

function localProceedsCents(order = {}) {
  // Cloud-shaped row (has total_paid_cents etc.) — reuse the reviewed helper
  // directly rather than re-deriving it.
  if (order.total_paid_cents != null || order.subtotal_cents != null) {
    return cloudSellerProceedsCents(order);
  }

  if (order.orderType === "fiat_pending" || order.orderType === "fiat_settled" || order.isFiat) {
    try {
      const items = typeof order.items === "string" ? JSON.parse(order.items || "[]") : order.items || [];
      const itemCents = items.reduce((sum, i) => sum + (Number(i.priceCentsUSD) || 0), 0);
      const shipCents = items.reduce((sum, i) => sum + (Number(i.shippingFeeCents) || 0), 0);
      if (itemCents || shipCents) return itemCents + shipCents;
    } catch {
      /* fall through to amountLocked below */
    }
  }

  const dollars = Number.parseFloat(order.amountLocked ?? order.price ?? "0") || 0;
  return Math.round(dollars * 100);
}

// ─── Payout ──────────────────────────────────────────────────────────────────

/**
 * Resolve the { bucket, proceedsCents } payout position for a single raw
 * order, reusing breederDashboard's exact status→bucket mapping (via
 * sellerPayoutBucket) rather than re-deriving it — this is the reviewed
 * money surface per docs/TASK_19_SELLER_OPS_SPEC.md §2.
 * @param {Object} order
 * @returns {{ bucket: ('protected'|'available'|'frozen'|'none'), proceedsCents: number }}
 */
export function resolvePayout(order) {
  const legacyStatus = getLocalStatusString(order || {});
  const bucket = sellerPayoutBucket(legacyStatus);
  return { bucket, proceedsCents: localProceedsCents(order) };
}

// ─── Customer (privacy-conscious) ───────────────────────────────────────────

/**
 * Privacy-conscious buyer handle for the seller's order row/detail — an
 * alias only, never the raw wallet (spec §2/§3 "Customer communication...
 * Privacy: alias only").
 * @param {Object} order
 * @returns {{ alias: string }}
 */
export function resolveCustomer(order) {
  return { alias: order?.buyer ? generateAlias(order.buyer) : generateAlias("") };
}

// ─── The main assembler ──────────────────────────────────────────────────────

/**
 * Assemble the full seller-facing view model for one raw local order record.
 *
 * @param {Object} order - a Dexie marketOrders record (or equivalent legacy shape)
 * @param {{ casual?: boolean }} [ctx]
 * @returns {Object} the seller order view model (see docs/TASK_19_SELLER_OPS_SPEC.md §2)
 */
export function assembleSellerOrderView(order, ctx = {}) {
  const casual = ctx.casual !== false;
  const method = resolveMethod(order);
  const canonicalState = resolveCanonicalState(order);
  const hasOpenClaim = canonicalState === S.CLAIM_OPEN;

  const status = orderStatusLabel(canonicalState, { casual });
  const sellerNextAction = sellerNextActionCopy({ method, canonicalState, hasOpenClaim }, { casual });

  return {
    id: orderKey(order),
    raw: order,
    role: order?.role || null,

    method,
    canonicalState,
    status, // { label, tone, icon }
    sellerNextAction, // { kind, copy }

    payout: resolvePayout(order),
    customer: resolveCustomer(order),

    claim: {
      state: hasOpenClaim ? "open" : canonicalState === S.PARTIALLY_RESOLVED ? "resolved" : "none",
    },

    // Convenience passthroughs used by list rendering (filter/search/sort).
    createdAt: order?.createdAt ?? null,
    commonName: order?.commonName || "",
    trackingNumber: order?.trackingNumber || null,
    quantity: order?.quantity ?? null,
  };
}

/** Stable identity for a raw order record — same scheme as buyerOrderView. */
function orderKey(order) {
  if (!order) return null;
  if (order.orderType === "shipping" && order.tokenId != null) return `ship-${order.tokenId}`;
  if (order.orderType === "batch" && order.purchaseId != null) return `batch-${order.purchaseId}`;
  if (order.stripeSessionId) return `fiat-${order.stripeSessionId}`;
  if (order.key != null) return `key-${order.key}`;
  return null;
}

// ─── List operations ─────────────────────────────────────────────────────────

/**
 * Map an array of raw local order records to seller view models.
 * @param {Array<Object>} rawOrders
 * @param {{ casual?: boolean }} [ctx]
 * @returns {Array<Object>}
 */
export function normalizeSellerOrders(rawOrders, ctx = {}) {
  return (rawOrders || []).map((o) => assembleSellerOrderView(o, ctx));
}

// Fulfillment-type tabs (spec §3): shipping / courier / prepaid pickup / cash pickup.
const FULFILLMENT_FILTER_MAP = Object.freeze({
  shipping: M.SHIPPING,
  courier: M.COURIER,
  prepaid_pickup: M.PREPAID_PICKUP,
  cash_pickup: M.CASH_PICKUP,
});

// Status filter buckets (spec §3): needs_action / in_progress / completed / claims.
const NEEDS_ACTION_KINDS = [
  SELLER_ACTION_KIND.BUY_LABEL,
  SELLER_ACTION_KIND.REQUEST_COURIER,
  SELLER_ACTION_KIND.SCHEDULE_PICKUP,
  SELLER_ACTION_KIND.SCAN_HANDOFF,
  SELLER_ACTION_KIND.CONFIRM_CASH,
  SELLER_ACTION_KIND.RESPOND_TO_CLAIM,
];
const COMPLETED_STATES = [S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED];
const CLAIM_STATES = [S.CLAIM_OPEN, S.PARTIALLY_RESOLVED];

/**
 * Filter + sort a set of seller order views. Defaults to "needs_action" per
 * spec §3 ("the daily loop... is one tap") — callers pass status explicitly
 * when they want a different default.
 *
 * @param {Array<Object>} views - from normalizeSellerOrders
 * @param {{
 *   fulfillment?: ('all'|'shipping'|'courier'|'prepaid_pickup'|'cash_pickup'),
 *   status?: ('all'|'needs_action'|'in_progress'|'completed'|'claims'),
 *   query?: string,
 * }} [opts]
 * @returns {Array<Object>}
 */
export function filterSellerOrders(views, opts = {}) {
  const { fulfillment = "all", status = "needs_action", query = "" } = opts;
  let result = views || [];

  if (fulfillment !== "all") {
    const method = FULFILLMENT_FILTER_MAP[fulfillment];
    result = result.filter((v) => v.method === method);
  }

  if (status === "needs_action") {
    result = result.filter((v) => NEEDS_ACTION_KINDS.includes(v.sellerNextAction.kind));
  } else if (status === "in_progress") {
    result = result.filter((v) => v.sellerNextAction.kind === SELLER_ACTION_KIND.AWAITING_BUYER);
  } else if (status === "completed") {
    result = result.filter((v) => COMPLETED_STATES.includes(v.canonicalState) || v.canonicalState === S.REFUNDED);
  } else if (status === "claims") {
    result = result.filter((v) => CLAIM_STATES.includes(v.canonicalState));
  }

  const q = query.trim().toLowerCase();
  if (q) {
    result = result.filter((v) => {
      const raw = v.raw || {};
      return (
        (v.commonName || "").toLowerCase().includes(q) ||
        (v.trackingNumber || "").toLowerCase().includes(q) ||
        (v.customer?.alias || "").toLowerCase().includes(q) ||
        String(raw.tokenId ?? "").includes(q) ||
        String(raw.purchaseId ?? "").includes(q)
      );
    });
  }

  const timeOf = (v) => v.createdAt || 0;
  const withIndex = result.map((v, idx) => ({ v, idx }));
  withIndex.sort((a, b) => {
    const diff = timeOf(b.v) - timeOf(a.v); // newest first, deterministic
    if (diff !== 0) return diff;
    return String(a.v.id).localeCompare(String(b.v.id)) || a.idx - b.idx;
  });

  return withIndex.map((x) => x.v);
}

export { ORDER_STATES, FULFILLMENT_METHODS };
