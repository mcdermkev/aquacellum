/**
 * breederStats.js — breeder achievement statistics, with each number's provenance
 * made explicit.
 *
 * Closes docs/BREEDER_STATE_MODEL.md §9.11.
 *
 * THE PROBLEM: `BreederAchievements` derived its `first_sale` and `sales_50`
 * badges from grow-out `sold` CHECKPOINTS — a number the breeder types into a
 * text field. So "Established Seller — Sold 50+ bred fish" was claimable by
 * typing 50 and pressing save. Every badge also carries a `ShareButton`, so that
 * self-assessment was one tap from being published as a claim about someone's
 * commercial history.
 *
 * THE DISTINCTION THIS MODULE ENFORCES:
 *
 *   VERIFIED    — derived from completed `marketOrders` where this account was
 *                 the seller. Real transactions with a counterparty. Only these
 *                 may back a shareable claim about sales.
 *   SELF-REPORTED — grow-out checkpoint counts. Genuinely useful: they're how the
 *                 breeder tracks their own funnel, and a fish rehomed at a club or
 *                 given to a friend is a real event that never touches an order.
 *                 But it is an assertion, not a record, so it cannot back a badge.
 *
 * The self-reported `sold` count is NOT discarded — it still correctly removes
 * fish from the living population in the funnel math (utils/growoutFunnel.js).
 * It just stops masquerading as sales history.
 */

import { db } from "../db";
import { aggregateGrowout } from "../utils/growoutFunnel";
import { ORDER_STATES } from "./marketplaceStateMachine";

/**
 * Canonical order states in which a sale has genuinely happened — the money has
 * settled or the certificate has moved. Deliberately excludes `refunded` and
 * `cancelled` (no sale) and every in-flight state (not yet a sale).
 */
export const SETTLED_SELLER_STATES = Object.freeze([
  ORDER_STATES.CERTIFICATE_TRANSFERRED,
  ORDER_STATES.SELLER_PAID,
  ORDER_STATES.COMPLETED,
]);

/**
 * Legacy numeric status meaning "released / completed" on the pre-canonical local
 * order shape written by `relayPurchaseSpecimen`. Kept because those rows still
 * exist in users' IndexedDB and dropping them would silently erase real history.
 */
const LEGACY_STATUS_RELEASED = 2;

/** Did this order actually complete as a sale? */
export function isSettledSale(order) {
  if (!order) return false;
  if (order.state) return SETTLED_SELLER_STATES.includes(order.state);
  // No canonical state — fall back to the legacy numeric status.
  return Number(order.status) === LEGACY_STATUS_RELEASED;
}

/**
 * Count completed sales where the given account was the seller.
 *
 * @param {Array<object>} orders - `marketOrders` rows
 * @param {string} walletAddress
 * @returns {{ count: number, firstAt: number|null }}
 */
export function countVerifiedSales(orders, walletAddress) {
  const seller = String(walletAddress || "").toLowerCase();
  if (!seller) return { count: 0, firstAt: null };

  const sales = (Array.isArray(orders) ? orders : []).filter(
    (o) => String(o?.seller || "").toLowerCase() === seller && isSettledSale(o)
  );

  const timestamps = sales.map((o) => Number(o.createdAt) || 0).filter(Boolean);
  return {
    count: sales.length,
    firstAt: timestamps.length > 0 ? Math.min(...timestamps) : null,
  };
}

/**
 * Assemble the full breeder stat set.
 *
 * Field names encode provenance so a future badge author can't accidentally
 * reach for the wrong one: anything ending `SelfReported` is an assertion.
 *
 * @param {string} walletAddress
 * @returns {Promise<object>}
 */
export async function loadBreederStats(walletAddress) {
  const wallet = String(walletAddress || "").toLowerCase();
  if (!wallet) return emptyStats();

  const [allSpawns, allCheckpoints, allOrders] = await Promise.all([
    db.spawns.toArray().catch(() => []),
    db.spawnGrowout.toArray().catch(() => []),
    db.marketOrders.toArray().catch(() => []),
  ]);

  const mySpawns = allSpawns.filter((s) => String(s.ownerAddress || "").toLowerCase() === wallet);

  // Group checkpoints by spawn once, rather than re-filtering per spawn.
  const bySpawn = new Map();
  for (const cp of allCheckpoints) {
    const key = Number(cp.spawnId);
    if (!bySpawn.has(key)) bySpawn.set(key, []);
    bySpawn.get(key).push(cp);
  }

  const funnels = mySpawns.map((s) => ({
    checkpoints: bySpawn.get(Number(s.spawnId)) || [],
    eggCount: (s.offspringIds || []).length || Number(s.offspringCount || 0),
  }));

  const growout = aggregateGrowout(funnels);
  const verified = countVerifiedSales(allOrders, wallet);

  return {
    totalSpawns: mySpawns.length,
    uniqueSpeciesBred: new Set(mySpawns.map((s) => Number(s.speciesId))).size,
    totalOffspring: funnels.reduce((sum, f) => sum + f.eggCount, 0),
    totalCheckpoints: growout.totalCheckpoints,
    totalFrySurvived: growout.totalAlive,
    bestSurvivalRate: growout.bestSurvivalRate,

    // VERIFIED — completed orders. The only figure a sales badge may use.
    verifiedSales: verified.count,
    firstVerifiedSaleAt: verified.firstAt,

    // SELF-REPORTED — the breeder's own grow-out tally. Shown as their own
    // record-keeping, never as a sales claim.
    frySoldSelfReported: growout.totalSoldSelfReported,
  };
}

function emptyStats() {
  return {
    totalSpawns: 0,
    uniqueSpeciesBred: 0,
    totalOffspring: 0,
    totalCheckpoints: 0,
    totalFrySurvived: 0,
    bestSurvivalRate: 0,
    verifiedSales: 0,
    firstVerifiedSaleAt: null,
    frySoldSelfReported: 0,
  };
}
