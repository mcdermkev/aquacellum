/**
 * useActivityFacts — the counts that ACTIVITY entitlements open on.
 *
 * Replaces XP as the condition for scale tools (see services/entitlements.js for
 * why). Each fact answers "is this tool useful to you yet?" rather than "have you
 * accumulated enough points?", so a capability appears the moment it starts
 * helping instead of after months of unrelated activity.
 *
 * WHY THESE THREE FACTS. Each has to be countable from a RECORD rather than an
 * assertion, or the gate is decorative. `verifiedSales` therefore reuses
 * `countVerifiedSales`/`isSettledSale` from breederStats.js — the same
 * verified-vs-self-reported distinction that module exists to enforce, after two
 * badges were found reading a `sold` count the breeder typed in by hand. Do not
 * add a fact sourced from a free-text field.
 *
 * ⚠️ RETURNS `null` UNTIL LOADED, AND THAT IS LOAD-BEARING.
 * `hasEntitlement` treats an absent fact as "cannot tell → allow", so gates are
 * OPEN while this resolves. The alternative — closed while loading — would flash
 * "locked" at a seller who has every right to the tool, which is the failure
 * users actually report as broken. The cost is a brief flash of an available
 * panel for someone who has not unlocked it yet; that is self-correcting and
 * strictly less harmful than telling a qualified user they are locked out.
 *
 * These are LOCAL counts (Dexie), which is fine for opening a convenience panel.
 * Anything that must resist inflation — money, or credibility shown to other
 * people — has to be derived server-side. `tier_discount` is deliberately NOT an
 * ACTIVITY entitlement for exactly this reason.
 */

import { useQuery } from "@tanstack/react-query";
import { db } from "../db";
import { countVerifiedSales, isSettledSale } from "../services/breederStats";

/**
 * Orders this account completed as the BUYER.
 *
 * Reuses `isSettledSale` because, despite its name, it tests the ORDER's state
 * (certificate transferred / seller paid / completed) and is role-neutral — the
 * buyer/seller distinction is the filter applied around it, not the predicate.
 *
 * @param {Array<object>} orders `marketOrders` rows
 * @param {string} walletAddress
 * @returns {number}
 */
export function countCompletedOrders(orders, walletAddress) {
  const buyer = String(walletAddress || "").toLowerCase();
  if (!buyer) return 0;
  return (Array.isArray(orders) ? orders : []).filter(
    (o) => String(o?.buyer || "").toLowerCase() === buyer && isSettledSale(o)
  ).length;
}

/**
 * Listings this account currently has published.
 *
 * Presence IS the active state: checkout deletes the row (`db.listings.delete`),
 * so there is no separate status flag to honour.
 *
 * @param {Array<object>} listings `listings` rows
 * @param {string} walletAddress
 * @returns {number}
 */
export function countActiveListings(listings, walletAddress) {
  const seller = String(walletAddress || "").toLowerCase();
  if (!seller) return 0;
  return (Array.isArray(listings) ? listings : []).filter(
    (l) => String(l?.seller || "").toLowerCase() === seller
  ).length;
}

/**
 * Compute all activity facts from already-loaded rows. Pure, so the gating rules
 * are testable without Dexie.
 *
 * @param {{orders?: Array, listings?: Array}} data
 * @param {string} walletAddress
 * @returns {{completedOrders:number, verifiedSales:number, activeListings:number}}
 */
export function computeActivityFacts({ orders = [], listings = [] }, walletAddress) {
  return {
    completedOrders: countCompletedOrders(orders, walletAddress),
    verifiedSales: countVerifiedSales(orders, walletAddress).count,
    activeListings: countActiveListings(listings, walletAddress),
  };
}

/**
 * @param {string|null|undefined} walletAddress
 * @returns {{completedOrders:number, verifiedSales:number, activeListings:number}|null}
 *   null while loading or with no account — callers pass it straight through as
 *   `hasEntitlement(key, { activity })`.
 */
export function useActivityFacts(walletAddress) {
  const { data } = useQuery({
    queryKey: ["activityFacts", (walletAddress || "").toLowerCase()],
    enabled: !!walletAddress,
    // Opening a convenience panel is not time-critical, and these counts only
    // change when an order settles or a listing is created.
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 30,
    queryFn: async () => {
      const owner = String(walletAddress).toLowerCase();
      // Read both tables defensively: a missing table (pre-migration device)
      // must yield "cannot tell", not a hard zero that locks a real seller out.
      let orders = [];
      let listings = [];
      try {
        orders = await db.marketOrders.toArray();
      } catch {
        return null;
      }
      try {
        listings = await db.listings.toArray();
      } catch {
        listings = [];
      }
      return computeActivityFacts({ orders, listings }, owner);
    },
  });

  return data ?? null;
}

export default useActivityFacts;
