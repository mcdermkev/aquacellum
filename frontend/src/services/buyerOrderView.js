/**
 * buyerOrderView.js
 *
 * Normalizes a raw local order record (Dexie `marketOrders` shipping/batch/
 * fiat_pending shapes, or an equivalent legacy-cloud `orders` row) into one
 * canonical-state-aware view model buyer surfaces render — regardless of
 * fulfillment method. Supersedes the inline status/timeline logic previously
 * duplicated across CheckoutSummary's filter/sort block and
 * OrderTimeline.buildSteps.
 *
 * IMPORTANT (see docs/TASK_18_BUYER_ORDERS_SPEC.md §0): this is presentation
 * normalization only. Buyer orders remain sourced from Dexie/legacy `orders`
 * (via ordersSync.js) — this module does NOT read canonical_orders and does
 * NOT change the order source of truth. It maps whatever shape it's given
 * onto the canonical vocabulary (marketplaceStateMachine ORDER_STATES) so the
 * UI speaks one status axis today and is forward-compatible with canonical
 * orders later (Task 23).
 *
 * Pure and dependency-free (besides orderCopy/marketplaceStateMachine).
 */

import { ORDER_STATES, FULFILLMENT_METHODS, legacyCloudStatusToCanonical } from "./marketplaceStateMachine.js";
import { orderStatusLabel, nextActionCopy, allowsProblemReport, cashNoProtectionDisclosure } from "./orderCopy.js";

const S = ORDER_STATES;
const M = FULFILLMENT_METHODS;

// ─── Method resolution ───────────────────────────────────────────────────────

/**
 * Resolve the canonical fulfillment method for a raw local order record.
 * @param {Object} order
 * @returns {string} a FULFILLMENT_METHODS value
 */
export function resolveMethod(order) {
  if (!order) return M.SHIPPING;
  if (order.orderType === "shipping") return M.SHIPPING;
  if (order.orderType === "batch") {
    // fulfillmentType: 0 = shipping, 1 = in-person handshake (prepaid pickup)
    return Number(order.fulfillmentType) === 1 ? M.PREPAID_PICKUP : M.SHIPPING;
  }
  if (order.orderType === "fiat_pending" || order.orderType === "fiat_settled" || order.isFiat) {
    // Fiat purchaseType carries the finer distinction where present.
    if (order.purchaseType === "pickup") return M.PREPAID_PICKUP;
    return M.SHIPPING;
  }
  if (order.orderType === "instant") return M.SHIPPING;
  return M.SHIPPING;
}

// ─── Canonical state resolution ──────────────────────────────────────────────

// Legacy shipping status ints (contract/Dexie): 0 LOCKED, 1 DISPATCHED,
// 2 RELEASED, 3 DISPUTED, 4 REFUNDED (see orderStatus.js / contracts). The
// legacy model has no separate handoff/certificate/payout states — RELEASED
// (2) is the terminal "money paid out + ownership transferred" state (see
// OrderReceipt.getStatusLabel, which already labels status 2 "Completed"),
// so it maps to the canonical terminal COMPLETED rather than the
// intermediate HANDOFF_CONFIRMED.
function shippingIntToCanonical(statusInt) {
  switch (Number(statusInt)) {
    case 0:
      return S.PAYMENT_PROTECTED;
    case 1:
      return S.IN_TRANSIT;
    case 2:
      return S.COMPLETED;
    case 3:
      return S.CLAIM_OPEN;
    case 4:
      return S.REFUNDED;
    default:
      return S.PAYMENT_PROTECTED;
  }
}

// Legacy batch state ints: 0 HELD, 1 COMPLETED/RELEASED, 2 REFUNDED. Same
// flattening as shipping — state 1 is terminal completion, not an
// intermediate handoff.
function batchStateToCanonical(stateInt, fulfillmentType) {
  const isPickup = Number(fulfillmentType) === 1;
  switch (Number(stateInt)) {
    case 0:
      return isPickup ? S.PICKUP_READY : S.PAYMENT_PROTECTED;
    case 1:
      return S.COMPLETED;
    case 2:
      return S.REFUNDED;
    default:
      return S.PAYMENT_PROTECTED;
  }
}

/**
 * Resolve the canonical order state for a raw local order record.
 * @param {Object} order
 * @returns {string} an ORDER_STATES value
 */
export function resolveCanonicalState(order) {
  if (!order) return S.CREATED;

  if (order.orderType === "shipping") {
    return shippingIntToCanonical(order.status);
  }
  if (order.orderType === "batch") {
    return batchStateToCanonical(order.state, order.fulfillmentType);
  }
  if (order.orderType === "fiat_pending" || order.orderType === "fiat_settled" || order.isFiat) {
    // fiat status strings mirror the legacy cloud vocabulary directly.
    const mapped = legacyCloudStatusToCanonical(order.status);
    return mapped || S.PAYMENT_PENDING;
  }
  if (order.orderType === "instant") {
    return S.COMPLETED;
  }
  return S.CREATED;
}

// ─── Timeline ────────────────────────────────────────────────────────────────

/**
 * Build the method-aware ordered timeline for a view. Ports the step
 * structure of the legacy OrderTimeline.buildSteps, now sourced from the
 * canonical state + orderCopy labels instead of ad hoc per-component copy.
 *
 * @param {{ method:string, canonicalState:string, timestamps:Object, hasOpenClaim?:boolean }} ctx
 * @param {{ casual?: boolean }} [opts]
 * @returns {Array<{ key:string, label:string, tone:string, ts:(number|null), state:('done'|'current'|'pending'|'alert') }>}
 */
export function buildTimeline({ method, canonicalState, timestamps = {}, hasOpenClaim = false }, opts = {}) {
  const casual = opts.casual !== false;
  const { createdAt = null, dispatchedAt = null, arrivedAt = null } = timestamps;
  const isPickupLike = method === M.PREPAID_PICKUP || method === M.CASH_PICKUP;

  const label = (state) => orderStatusLabel(state, { casual }).label;

  // Claim-open replaces the tail with a single alert step, regardless of method.
  if (canonicalState === S.CLAIM_OPEN || hasOpenClaim) {
    const steps = [{ key: "placed", label: label(S.CREATED), tone: "good", ts: createdAt, state: "done" }];
    if (!isPickupLike) steps.push({ key: "shipped", label: label(S.IN_TRANSIT), tone: "good", ts: dispatchedAt, state: "done" });
    steps.push({ key: "reported", label: label(S.CLAIM_OPEN), tone: "alert", ts: null, state: "alert" });
    return steps;
  }

  if (canonicalState === S.REFUNDED) {
    return [
      { key: "placed", label: label(S.CREATED), tone: "good", ts: createdAt, state: "done" },
      { key: "refunded", label: label(S.REFUNDED), tone: "alert", ts: null, state: "alert" },
    ];
  }

  if (canonicalState === S.PARTIALLY_RESOLVED) {
    return [
      { key: "placed", label: label(S.CREATED), tone: "good", ts: createdAt, state: "done" },
      { key: "resolved", label: label(S.PARTIALLY_RESOLVED), tone: "alert", ts: null, state: "alert" },
    ];
  }

  if (isPickupLike) {
    const placed = { key: "placed", label: label(S.CREATED), tone: "good", ts: createdAt, state: "done" };
    const ready = {
      key: "ready",
      label: label(S.PICKUP_READY),
      tone: "good",
      ts: null,
      state: [S.PICKUP_READY, S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED].includes(canonicalState) ? "done" : "pending",
    };
    const handoff = {
      key: "handoff",
      label: label(S.HANDOFF_CONFIRMED),
      tone: "good",
      ts: arrivedAt,
      state: [S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED].includes(canonicalState) ? "done" : "pending",
    };
    const steps = [placed, ready, handoff];
    markCurrent(steps);
    return steps;
  }

  // Shipping / courier — placed → shipped → arrived → confirmed.
  const placed = { key: "placed", label: label(S.CREATED), tone: "good", ts: createdAt, state: "done" };
  const shipped = {
    key: "shipped",
    label: label(S.IN_TRANSIT),
    tone: "good",
    ts: dispatchedAt,
    state: [S.IN_TRANSIT, S.NON_DELIVERY, S.DELIVERED, S.REVIEW_WINDOW, S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED].includes(canonicalState) ? "done" : "pending",
  };
  const arrived = {
    key: "arrived",
    label: label(S.DELIVERED),
    tone: "good",
    ts: arrivedAt,
    state: [S.DELIVERED, S.REVIEW_WINDOW, S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED].includes(canonicalState) ? "done" : "pending",
  };
  const confirmed = {
    key: "confirmed",
    label: label(S.HANDOFF_CONFIRMED),
    tone: "good",
    ts: [S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED].includes(canonicalState) ? arrivedAt : null,
    state: [S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED].includes(canonicalState) ? "done" : "pending",
  };
  const steps = [placed, shipped, arrived, confirmed];
  markCurrent(steps);
  return steps;
}

/** Mark the first non-done step as the current (in-progress) step. */
function markCurrent(steps) {
  const idx = steps.findIndex((s) => s.state !== "done");
  if (idx >= 0 && steps[idx].state === "pending") {
    steps[idx].state = "current";
  }
}

// ─── The main assembler ──────────────────────────────────────────────────────

/**
 * Assemble the full buyer-facing view model for one raw local order record.
 *
 * @param {Object} order - a Dexie marketOrders record (or equivalent legacy shape)
 * @param {{ casual?: boolean, now?: number }} [ctx]
 * @returns {Object} the buyer order view model (see docs/TASK_18_BUYER_ORDERS_SPEC.md §2)
 */
export function assembleBuyerOrderView(order, ctx = {}) {
  const casual = ctx.casual !== false;
  const method = resolveMethod(order);
  const canonicalState = resolveCanonicalState(order);
  const hasOpenClaim = canonicalState === S.CLAIM_OPEN;

  const timestamps = {
    createdAt: order?.createdAt ?? null,
    dispatchedAt: order?.dispatchTimestamp ?? null,
    arrivedAt: order?.arrivedAt ?? null,
  };

  const timeline = buildTimeline({ method, canonicalState, timestamps, hasOpenClaim }, { casual });
  const status = orderStatusLabel(canonicalState, { casual });
  const nextAction = nextActionCopy({ method, canonicalState, hasOpenClaim }, { casual });

  const isCash = method === M.CASH_PICKUP;
  const isTerminal = [S.COMPLETED, S.SELLER_PAID, S.CERTIFICATE_TRANSFERRED, S.REFUNDED, S.CANCELLED].includes(canonicalState);

  return {
    // Identity + raw passthrough for components that still need the record.
    id: orderKey(order),
    raw: order,
    role: order?.role || null,

    method,
    canonicalState,
    status, // { label, tone, icon }
    timeline,
    nextAction, // { kind, copy }

    claim: {
      state: hasOpenClaim ? "open" : canonicalState === S.PARTIALLY_RESOLVED ? "resolved" : canonicalState === S.REFUNDED ? "resolved" : "none",
      allowed: allowsProblemReport(method) && !isTerminal,
    },

    cashDisclosure: isCash ? cashNoProtectionDisclosure({ casual }) : null,

    ownership: {
      transferred: [S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED].includes(canonicalState),
      specimenId: order?.tokenId ?? null,
    },

    // Convenience passthroughs used by list rendering (sort/search/filter).
    createdAt: timestamps.createdAt,
    commonName: order?.commonName || "",
    trackingNumber: order?.trackingNumber || null,
  };
}

/** Stable identity for a raw order record, used for keys and deep links. */
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
 * Map an array of raw local order records to view models.
 * @param {Array<Object>} rawOrders
 * @param {{ casual?: boolean }} [ctx]
 * @returns {Array<Object>}
 */
export function normalizeBuyerOrders(rawOrders, ctx = {}) {
  return (rawOrders || []).map((o) => assembleBuyerOrderView(o, ctx));
}

const ACTIVE_STATES = [
  S.CREATED, S.PAYMENT_PENDING, S.PAYMENT_PROTECTED, S.PREPARING,
  S.IN_TRANSIT, S.PICKUP_READY, S.DELIVERED, S.REVIEW_WINDOW, S.NON_DELIVERY,
];
const COMPLETED_STATES = [S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED];
const DISPUTED_STATES = [S.CLAIM_OPEN, S.PARTIALLY_RESOLVED];

/**
 * Filter + sort a set of buyer order views. Mirrors the filter tabs
 * (all/active/completed/disputed), text search, and sort options previously
 * inline in CheckoutSummary.
 *
 * @param {Array<Object>} views - from normalizeBuyerOrders
 * @param {{ status?:('all'|'active'|'completed'|'disputed'), query?:string, sort?:('newest'|'oldest'|'price_high'|'price_low') }} [opts]
 * @returns {Array<Object>}
 */
export function filterBuyerOrders(views, opts = {}) {
  const { status = "all", query = "", sort = "newest" } = opts;
  let result = views || [];

  if (status === "active") {
    result = result.filter((v) => ACTIVE_STATES.includes(v.canonicalState));
  } else if (status === "completed") {
    result = result.filter((v) => COMPLETED_STATES.includes(v.canonicalState) || v.canonicalState === S.REFUNDED);
  } else if (status === "disputed") {
    result = result.filter((v) => DISPUTED_STATES.includes(v.canonicalState));
  }

  const q = query.trim().toLowerCase();
  if (q) {
    result = result.filter((v) => {
      const raw = v.raw || {};
      return (
        (v.commonName || "").toLowerCase().includes(q) ||
        (v.trackingNumber || "").toLowerCase().includes(q) ||
        String(raw.tokenId ?? "").includes(q) ||
        String(raw.purchaseId ?? "").includes(q)
      );
    });
  }

  const priceOf = (v) => Number.parseFloat(v.raw?.amountLocked ?? v.raw?.price ?? "0") || 0;
  const timeOf = (v) => v.createdAt || 0;

  const withIndex = result.map((v, idx) => ({ v, idx }));
  withIndex.sort((a, b) => {
    let diff;
    switch (sort) {
      case "oldest":
        diff = timeOf(a.v) - timeOf(b.v);
        break;
      case "price_high":
        diff = priceOf(b.v) - priceOf(a.v);
        break;
      case "price_low":
        diff = priceOf(a.v) - priceOf(b.v);
        break;
      default:
        diff = timeOf(b.v) - timeOf(a.v); // newest
    }
    if (diff !== 0) return diff;
    // Deterministic tiebreak by stable id.
    return String(a.v.id).localeCompare(String(b.v.id)) || a.idx - b.idx;
  });

  return withIndex.map((x) => x.v);
}

export { ORDER_STATES, FULFILLMENT_METHODS };
