/**
 * customerSegments.js
 *
 * Privacy-conscious customer groupings for a seller (Task 21B, Tier B).
 * Pure aggregation over the seller's own order rows
 * (`ordersSync.fetchSellerOrders` shape) — no network, no PII: every buyer
 * is identified only by `generateAlias(buyerWallet)`, never the raw wallet.
 *
 * This is buyer-VALUE reporting (what a buyer has purchased from this
 * seller), not seller earnings — it intentionally reads `total_paid_cents`
 * (what the buyer paid) rather than `breederDashboard.sellerProceedsCents`
 * (what the seller nets after the platform fee). The two numbers answer
 * different questions; using proceeds here would understate a buyer's
 * actual purchasing value. `cashSaleReport`/`boxUtilization` (Task 21C) are
 * the modules that report seller revenue and correctly reuse
 * `sellerProceedsCents` for that.
 *
 * Pure, deterministic, no side effects.
 */

import { generateAlias } from "../utils/generateAlias.js";

const COMPLETED_STATUSES = Object.freeze(["released", "completed", "settled", "resolved_released"]);
const DEFAULT_AT_RISK_DAYS = 60;
const DEFAULT_HIGH_VALUE_TOP_N = 5;

function toEpochMs(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Group a seller's order rows by buyer wallet into a per-buyer summary.
 * @param {Object[]} orders - orders table rows (buyer_wallet/total_paid_cents/status/created_at)
 * @returns {Map<string, { alias:string, orderCount:number, completedCount:number, totalSpentCents:number, lastOrderAtMs:(number|null) }>}
 */
function groupByBuyer(orders) {
  const byBuyer = new Map();
  for (const order of orders || []) {
    const wallet = (order?.buyer_wallet || "").toLowerCase();
    if (!wallet) continue;

    const entry = byBuyer.get(wallet) || {
      wallet,
      alias: generateAlias(wallet),
      orderCount: 0,
      completedCount: 0,
      totalSpentCents: 0,
      lastOrderAtMs: null,
    };

    entry.orderCount += 1;
    const isCompleted = COMPLETED_STATUSES.includes(order.status);
    if (isCompleted) {
      entry.completedCount += 1;
      entry.totalSpentCents += Number.isFinite(order.total_paid_cents) ? order.total_paid_cents : 0;
    }

    const createdMs = toEpochMs(order.created_at);
    if (createdMs != null && (entry.lastOrderAtMs == null || createdMs > entry.lastOrderAtMs)) {
      entry.lastOrderAtMs = createdMs;
    }

    byBuyer.set(wallet, entry);
  }
  return byBuyer;
}

/** Strip the raw wallet from a buyer summary before it ever leaves this module — alias-only output. */
function toPublicSummary(entry) {
  return {
    alias: entry.alias,
    orderCount: entry.orderCount,
    completedCount: entry.completedCount,
    totalSpentCents: entry.totalSpentCents,
    lastOrderAtMs: entry.lastOrderAtMs,
  };
}

/**
 * Build the three privacy-conscious customer segments for a seller.
 *
 * - repeatBuyers: buyers with 2+ completed orders, most orders first.
 * - highValueBuyers: top N buyers by totalSpentCents (completed orders only).
 * - atRiskBuyers: buyers with at least one completed order whose most recent
 *   order is older than `atRiskDays` (a former customer who's gone quiet) —
 *   never flags a buyer with zero completed orders as "at risk" (no signal).
 *
 * @param {Object[]} orders - the seller's own orders (fetchSellerOrders shape)
 * @param {{ now?: (number|Date|string), atRiskDays?: number, highValueTopN?: number }} [opts]
 * @returns {{ repeatBuyers:Object[], highValueBuyers:Object[], atRiskBuyers:Object[], sampleSize:number }}
 */
export function buildCustomerSegments(orders, opts = {}) {
  const safeOrders = Array.isArray(orders) ? orders : [];
  const nowMs = toEpochMs(opts.now) ?? Date.now();
  const atRiskDays = Number.isFinite(opts.atRiskDays) ? opts.atRiskDays : DEFAULT_AT_RISK_DAYS;
  const topN = Number.isFinite(opts.highValueTopN) ? opts.highValueTopN : DEFAULT_HIGH_VALUE_TOP_N;
  const atRiskMs = atRiskDays * 24 * 60 * 60 * 1000;

  const byBuyer = groupByBuyer(safeOrders);
  const buyers = Array.from(byBuyer.values());

  const repeatBuyers = buyers
    .filter((b) => b.completedCount >= 2)
    .sort((a, b) => b.completedCount - a.completedCount || a.wallet.localeCompare(b.wallet))
    .map(toPublicSummary);

  const highValueBuyers = buyers
    .filter((b) => b.totalSpentCents > 0)
    .sort((a, b) => b.totalSpentCents - a.totalSpentCents || a.wallet.localeCompare(b.wallet))
    .slice(0, topN)
    .map(toPublicSummary);

  const atRiskBuyers = buyers
    .filter((b) => b.completedCount >= 1 && b.lastOrderAtMs != null && nowMs - b.lastOrderAtMs > atRiskMs)
    .sort((a, b) => (a.lastOrderAtMs ?? 0) - (b.lastOrderAtMs ?? 0) || a.wallet.localeCompare(b.wallet))
    .map(toPublicSummary);

  return { repeatBuyers, highValueBuyers, atRiskBuyers, sampleSize: buyers.length };
}
