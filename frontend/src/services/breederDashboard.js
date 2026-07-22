/**
 * breederDashboard.js
 *
 * Pure aggregation module for the Breeder Terminal dashboard home (Task 9,
 * Increment 1, Tier B). `buildBreederDashboard({ orders, listings, now,
 * lastVisitAt })` reduces the seller's legacy `orders` rows and listings into
 * the six-card dashboard view model: newOrders, pendingActions, earnings,
 * lowStock, and openClaims.
 *
 * The **earnings** mapping (§3) mirrors the payment ledger's protected-vs-paid
 * semantics over the legacy `orders.status` column and is implemented exactly
 * as specified — this is the money-display surface that gets an Opus review
 * before merge. Do not adjust the status→bucket mapping without one.
 *
 * Pure and dependency-free: no fetching, no side effects, deterministic for
 * identical inputs.
 */

// ─── Legacy status buckets (§3) ─────────────────────────────────────────────
// These mirror marketplaceStateMachine.js's LEGACY_CLOUD_TO_CANONICAL values
// exactly (pending/locked/dispatched/released/resolved_released/completed/
// settled/disputed/refunded/failed) but are kept as a local, literal set per
// the spec rather than importing that mapping, since the spec's buckets group
// legacy statuses differently than the canonical state each maps to (e.g.
// "released" and "resolved_released" both count as PROTECTED→AVAILABLE-ish
// buckets here, not by canonical state).

// Exported (not just module-local) so other seller surfaces — notably
// sellerOrderView.js's per-order payout chip (Task 19) — can derive the exact
// same protected/available/frozen bucket for a single order without forking
// this mapping. This is the reviewed money surface; import it, don't re-list
// the status strings elsewhere.
export const PROTECTED_STATUSES = Object.freeze(["locked", "dispatched"]);
export const AVAILABLE_STATUSES = Object.freeze(["released", "resolved_released", "completed", "settled"]);
export const FROZEN_STATUSES = Object.freeze(["disputed"]);
export const EXCLUDED_STATUSES = Object.freeze(["pending", "failed", "refunded"]);

const DEFAULT_LOW_STOCK_THRESHOLD = 2;

/**
 * Per-order seller proceeds in cents: subtotal minus platform fee when both
 * are present, else the full total paid (legacy rows that predate itemized
 * fee columns). Exported so per-order surfaces (sellerOrderView.js) compute
 * proceeds identically to this dashboard aggregation rather than forking the
 * formula.
 * @param {Object} order
 * @returns {number}
 */
export function sellerProceedsCents(order = {}) {
  const subtotal = order.subtotal_cents;
  const platformFee = order.platform_fee_cents;
  if (Number.isFinite(subtotal) && Number.isFinite(platformFee)) {
    return subtotal - platformFee;
  }
  return Number.isFinite(order.total_paid_cents) ? order.total_paid_cents : 0;
}

/**
 * Build the Breeder Terminal dashboard view model.
 *
 * @param {Object} params
 * @param {Object[]} [params.orders] - the seller's legacy `orders` rows
 *   (fetchSellerOrders shape: created_at, status, order_type,
 *   fulfillment_type, subtotal_cents?, platform_fee_cents?, total_paid_cents,
 *   items?, ...)
 * @param {Object[]} [params.listings] - the seller's listings (single +
 *   batch, in the mixed shape used across catalogQuery.js/listingManager.js)
 * @param {number|Date} [params.now] - current time (epoch ms or Date);
 *   defaults to Date.now()
 * @param {number|Date|string|null} [params.lastVisitAt] - epoch ms, Date, or
 *   ISO string of the seller's last Terminal visit; null/undefined means
 *   "no prior visit" (every order counts as new)
 * @param {number} [params.lowStockThreshold] - batch quantity at/under which
 *   a listing is flagged low-stock (default 2)
 * @returns {{
 *   newOrders: { count:number, items:Object[], byType: Object<string, number> },
 *   pendingActions: {
 *     toDispatch: { count:number, items:Object[] },
 *     toHandoff: { count:number, items:Object[] },
 *     cashMeets: { count:number, items:Object[] },
 *   },
 *   earnings: { protectedCents:number, availableCents:number, frozenCents:number },
 *   lowStock: { items:Object[] },
 *   openClaims: { count:number, items:Object[] },
 * }}
 */
export function buildBreederDashboard({ orders, listings, now, lastVisitAt, lowStockThreshold } = {}) {
  const safeOrders = Array.isArray(orders) ? orders : [];
  const safeListings = Array.isArray(listings) ? listings : [];
  const threshold = Number.isFinite(lowStockThreshold) ? lowStockThreshold : DEFAULT_LOW_STOCK_THRESHOLD;
  // `now` is accepted per the spec's signature (callers can pin the clock for
  // deterministic tests) but none of the current buckets are time-relative
  // beyond the lastVisitAt comparison in newOrders, so it isn't consumed
  // yet. Validating it here (rather than silently dropping it) keeps the
  // parameter meaningful for a future aging/ordering feature.
  void toEpochMs(now);

  return {
    newOrders: buildNewOrders(safeOrders, lastVisitAt),
    pendingActions: buildPendingActions(safeOrders),
    earnings: buildEarnings(safeOrders),
    lowStock: buildLowStock(safeListings, threshold),
    openClaims: buildOpenClaims(safeOrders),
  };
}

// ─── newOrders (§3) ──────────────────────────────────────────────────────────

function toEpochMs(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildNewOrders(orders, lastVisitAt) {
  const lastVisitMs = toEpochMs(lastVisitAt);

  // No prior visit: treat every order as new (nothing to compare against).
  const items = lastVisitMs == null
    ? orders.slice()
    : orders.filter((o) => {
        const createdMs = toEpochMs(o.created_at);
        return createdMs != null && createdMs > lastVisitMs;
      });

  const byType = {};
  for (const order of items) {
    const type = order.order_type || "unknown";
    byType[type] = (byType[type] || 0) + 1;
  }

  return { count: items.length, items, byType };
}

// ─── pendingActions (§3) ─────────────────────────────────────────────────────
//
// All three buckets are orders currently sitting in "locked" — payment
// protected, awaiting the seller's next fulfillment action — split by how
// that action is taken:
//   - toDispatch: needs a shipping dispatch/prep (not an in-person handoff)
//   - toHandoff: an in-person (prepaid) pickup awaiting handoff
//   - cashMeets: a cash-handshake meet awaiting completion (order_type
//     "cash_handshake" is the distinct cash-pickup path — see
//     FULFILLMENT_METHODS.CASH_PICKUP vs PREPAID_PICKUP in
//     marketplaceStateMachine.js — and is called out separately even though
//     it's also typically in-person).

function buildPendingActions(orders) {
  const locked = orders.filter((o) => o.status === "locked");

  const cashMeets = locked.filter((o) => o.order_type === "cash_handshake");
  const toHandoff = locked.filter((o) => o.fulfillment_type === "in_person" && o.order_type !== "cash_handshake");
  const toDispatch = locked.filter((o) => o.fulfillment_type !== "in_person" && o.order_type !== "cash_handshake");

  return {
    toDispatch: { count: toDispatch.length, items: toDispatch },
    toHandoff: { count: toHandoff.length, items: toHandoff },
    cashMeets: { count: cashMeets.length, items: cashMeets },
  };
}

// ─── earnings (§3 — implement exactly; review-gated) ────────────────────────

function buildEarnings(orders) {
  let protectedCents = 0;
  let availableCents = 0;
  let frozenCents = 0;

  for (const order of orders) {
    const status = order.status;
    if (EXCLUDED_STATUSES.includes(status)) continue;

    const proceeds = sellerProceedsCents(order);

    if (PROTECTED_STATUSES.includes(status)) {
      protectedCents += proceeds;
    } else if (AVAILABLE_STATUSES.includes(status)) {
      availableCents += proceeds;
    } else if (FROZEN_STATUSES.includes(status)) {
      frozenCents += proceeds;
    }
    // Any other/unrecognized status is silently excluded (not one of the
    // three buckets and not in EXCLUDED_STATUSES) — conservative default.
  }

  return { protectedCents, availableCents, frozenCents };
}

/**
 * Resolve the protected/available/frozen/none bucket for a single legacy
 * order status string — the same classification buildEarnings applies when
 * summing across many orders. Exported for per-order payout chips
 * (sellerOrderView.js) so a single order's bucket always agrees with what
 * the dashboard would put it in.
 * @param {string} status - a legacy `orders.status` value
 * @returns {'protected'|'available'|'frozen'|'none'}
 */
export function sellerPayoutBucket(status) {
  if (PROTECTED_STATUSES.includes(status)) return "protected";
  if (AVAILABLE_STATUSES.includes(status)) return "available";
  if (FROZEN_STATUSES.includes(status)) return "frozen";
  return "none";
}

// ─── lowStock (§3) ───────────────────────────────────────────────────────────

function buildLowStock(listings, threshold) {
  const items = listings.filter((item) => {
    if (item.isBatch) {
      const qty = Number(item.quantity);
      return Number.isFinite(qty) && qty <= threshold;
    }
    // Single listings: flagged when explicitly sold/inactive.
    if (item.active === false) return true;
    if (item.status === "sold") return true;
    return false;
  });

  return { items };
}

// ─── openClaims (§3) ─────────────────────────────────────────────────────────

function buildOpenClaims(orders) {
  const items = orders.filter((o) => o.status === "disputed");
  return { count: items.length, items };
}
