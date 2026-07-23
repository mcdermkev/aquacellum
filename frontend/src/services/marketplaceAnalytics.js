/**
 * marketplaceAnalytics.js
 *
 * Pure aggregation reducers for Task 21C (box utilization, local-delivery
 * performance, cash-sale reporting, conversion funnel). Deterministic, no
 * network — every function takes plain order rows (the `orders` table shape
 * from ordersSync.js: order_type/fulfillment_type/status/items/cents fields/
 * dispatch_timestamp/arrived_at/metadata) and returns a small aggregate.
 *
 * Money-mapping rule (hard, source-guard enforced): any proceeds/revenue
 * figure in this module comes from `breederDashboard.sellerProceedsCents` —
 * this file never re-derives a `subtotal - platform_fee` formula locally.
 *
 * Every reducer reports its `sampleSize` and degrades gracefully when the
 * signal it needs isn't present on the order rows — it never fabricates a
 * number from absent data (see docs/TASK_21C_ANALYTICS_SPEC.md §2/§6).
 */

import { sellerProceedsCents } from "./breederDashboard.js";
import { boxesRequired, remainingCapacity, PACKING_DEFAULTS, normalizeParcelPreset } from "./packingEngine.js";

// ─── Web2-safe copy (Task 2 language system) ───────────────────────────────

export const ANALYTICS_COPY = Object.freeze({
  boxUtilizationTitle: "Box Utilization",
  localDeliveryTitle: "Local Delivery Performance",
  cashSaleTitle: "Cash Sales",
  conversionFunnelTitle: "Conversion Funnel",
  noDataYet: "Not enough data yet",
  fundsStatusNote: "Cash sales move no platform payment — this is a count, not a payout figure.",
});

// ─── Box utilization ─────────────────────────────────────────────────────────

/**
 * Average parcel fill and the count of orders that stayed within a single
 * box (avoided a second-box shipping-rate bump). Composes packingEngine's
 * capacity math over each order's recorded packing usage — never reimplements
 * boxesRequired/remainingCapacity locally.
 *
 * Degrades gracefully: an order contributes to the aggregate only when it
 * carries packing usage data (order.metadata.packingUsage — the same
 * `computeUsage` shape — and/or order.metadata.parcels). Orders missing that
 * data are excluded from the average, not counted as 0% fill.
 *
 * @param {Object[]} orders
 * @param {{ preset?: Object }} [opts] - normalizeParcelPreset output; defaults
 *   to PACKING_DEFAULTS when the caller has no seller-specific preset
 * @returns {{ avgFillPercent:(number|null), avoidedExtraBoxes:number, sampleSize:number }}
 */
export function boxUtilization(orders = [], opts = {}) {
  const preset = opts.preset ? normalizeParcelPreset(opts.preset) : normalizeParcelPreset(PACKING_DEFAULTS);

  const usable = (Array.isArray(orders) ? orders : []).filter((o) => o?.metadata?.packingUsage);

  if (usable.length === 0) {
    return { avgFillPercent: null, avoidedExtraBoxes: 0, sampleSize: 0 };
  }

  let fillSum = 0;
  let avoidedExtraBoxes = 0;

  for (const order of usable) {
    const usage = order.metadata.packingUsage;
    const parcels = Number.isFinite(Number(order.metadata.parcels))
      ? Number(order.metadata.parcels)
      : boxesRequired(preset, usage);

    const remaining = remainingCapacity(preset, usage);
    const ratios = [
      preset.usableWeightOz > 0 ? usage.weightOz / preset.usableWeightOz : 0,
      preset.maxBags > 0 ? usage.bags / preset.maxBags : 0,
      preset.usableVolumeIn3 > 0 ? usage.volumeIn3 / preset.usableVolumeIn3 : 0,
      preset.maxLivestock > 0 ? usage.livestock / preset.maxLivestock : 0,
    ];
    const fillRatio = Math.max(0, Math.min(1, Math.max(...ratios)));
    fillSum += fillRatio;

    if (parcels <= 1 && remaining.livestock <= 0) avoidedExtraBoxes += 1;
    void remaining; // remaining computed for parity with packingEngine's own reasoning; not otherwise consumed here
  }

  return {
    avgFillPercent: Math.round((fillSum / usable.length) * 100),
    avoidedExtraBoxes,
    sampleSize: usable.length,
  };
}

// ─── Local delivery performance ─────────────────────────────────────────────

/**
 * Courier (local-delivery) fulfillment health across an order set. Reads
 * whatever delivery signal is present on `order.metadata.delivery` (the
 * localDeliveryAdapter.js normalized shape: { quoted, accepted, delivered,
 * delayed }) — courier orders lacking that metadata are excluded from the
 * rate denominators, never counted as failures.
 *
 * @param {Object[]} orders
 * @returns {{ quoteAcceptanceRate:(number|null), successfulDeliveryRate:(number|null), delayRate:(number|null), sampleSize:number }}
 */
export function localDeliveryPerformance(orders = []) {
  const courierOrders = (Array.isArray(orders) ? orders : []).filter(
    (o) => o?.fulfillment_type === "courier" || o?.order_type === "courier"
  );

  const withDeliveryData = courierOrders.filter((o) => o?.metadata?.delivery);
  if (withDeliveryData.length === 0) {
    return { quoteAcceptanceRate: null, successfulDeliveryRate: null, delayRate: null, sampleSize: 0 };
  }

  const quoted = withDeliveryData.filter((o) => o.metadata.delivery.quoted === true);
  const accepted = withDeliveryData.filter((o) => o.metadata.delivery.accepted === true);
  const delivered = withDeliveryData.filter((o) => o.metadata.delivery.delivered === true);
  const delayed = withDeliveryData.filter((o) => o.metadata.delivery.delayed === true);

  return {
    quoteAcceptanceRate: quoted.length > 0 ? round2(accepted.length / quoted.length) : null,
    successfulDeliveryRate: accepted.length > 0 ? round2(delivered.length / accepted.length) : null,
    delayRate: round2(delayed.length / withDeliveryData.length),
    sampleSize: withDeliveryData.length,
  };
}

// ─── Cash sale report ────────────────────────────────────────────────────────

/**
 * Cash-handshake activity — report-only. Cash sales move no platform
 * payment (plan "DOA Protection Policy" / no protected payment to freeze),
 * so this reports the order's recorded amount (`sellerProceedsCents`, the
 * one reviewed money mapping), never a payout/settlement figure.
 *
 * @param {Object[]} orders
 * @returns {{ count:number, volumeCents:number, sampleSize:number }}
 */
export function cashSaleReport(orders = []) {
  const cashOrders = (Array.isArray(orders) ? orders : []).filter((o) => o?.order_type === "cash_handshake");
  const volumeCents = cashOrders.reduce((sum, o) => sum + sellerProceedsCents(o), 0);

  return { count: cashOrders.length, volumeCents, sampleSize: cashOrders.length };
}

// ─── Conversion funnel ───────────────────────────────────────────────────────

/**
 * Assemble whatever conversion stages are actually derivable. Upstream
 * stages (impressions, add-to-cart) require event instrumentation this
 * project does not yet have (see spec §6 out-of-scope) — when `events` is
 * absent/empty, those stages are reported `null` with a `note` rather than
 * fabricated from order counts. `checkout`/`completed` are always derivable
 * from order rows alone (every row IS a checkout attempt; "completed" is a
 * terminal/paid status).
 *
 * @param {Object[]} [events] - optional instrumentation events, shape
 *   { type: 'impression'|'add_to_cart'|'checkout'|'completed' }[]
 * @param {Object[]} orders
 * @returns {{ impressions:(number|null), addToCart:(number|null), checkout:number,
 *   completed:number, rates:{ checkoutToCompleted:(number|null) }, note:(string|null) }}
 */
export function conversionFunnel(events, orders = []) {
  const safeOrders = Array.isArray(orders) ? orders : [];
  const checkout = safeOrders.length;
  const completed = safeOrders.filter((o) =>
    ["released", "completed", "settled", "resolved_released"].includes(o?.status)
  ).length;

  const hasEvents = Array.isArray(events) && events.length > 0;
  const impressions = hasEvents ? events.filter((e) => e?.type === "impression").length : null;
  const addToCart = hasEvents ? events.filter((e) => e?.type === "add_to_cart").length : null;

  return {
    impressions,
    addToCart,
    checkout,
    completed,
    rates: {
      checkoutToCompleted: checkout > 0 ? round2(completed / checkout) : null,
    },
    note: hasEvents
      ? null
      : "Impression and add-to-cart data require event instrumentation, which isn't wired up yet — only checkout→completed is shown.",
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function round2(n) {
  return Math.round(n * 100) / 100;
}
