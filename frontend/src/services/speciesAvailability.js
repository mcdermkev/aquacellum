/**
 * speciesAvailability.js — per-species marketplace availability projection for
 * Fish Finder (Fish Finder Rework, Task 3 / Tier A).
 *
 * Turns the raw, mixed-source marketplace listing array (on-chain + cloud +
 * local, as merged by `useMarketplaceListings`) into a per-species summary the
 * discovery surfaces render as "Available from N sellers · from $X" and use to
 * route a shopper to the listings.
 *
 * This is money-adjacent, so it does NOT invent pricing or availability. It
 * composes the canonical marketplace helpers from `catalogQuery.js`:
 *   - `isListingActive`     — the one active/sold rule (also used by cart
 *                             revalidation), so a sold listing is never shown
 *                             as available.
 *   - `normalizePriceCents` — the one price parser (handles every listing price
 *                             shape); all money stays integer USD cents.
 *   - `formatPriceCents`    — the one USD formatter.
 *   - `getListingKey`       — the stable per-listing key, used to de-duplicate
 *                             within a species aggregate (batch vs single ids
 *                             can otherwise collide).
 *
 * Scope note (honors MARKETPLACE_STATE_MODEL): this is a *discovery* signal
 * built from active listings. It intentionally does not subtract reservation
 * holds (TTL reservations are resolved at checkout by reservationManager) or
 * read the canonical `orders` table — a species is "available" if it has active
 * listings with stock. It never claims availability for a sold/inactive listing.
 *
 * Pure and deterministic: safe to call in render / memoize.
 */

import {
  isListingActive,
  normalizePriceCents,
  formatPriceCents,
  getListingKey,
} from "./catalogQuery.js";

/** Lowercased seller identity, tolerant of the field variants across sources. */
function sellerKey(item) {
  const s = item.seller ?? item.sellerAddress ?? item.ownerAddress ?? "";
  return String(s).trim().toLowerCase();
}

/**
 * Units a listing makes available: a single specimen is 1; a batch is its
 * remaining quantity. A batch with a missing/zero quantity contributes 0 (it is
 * active but effectively out of stock and should not inflate availability).
 */
function unitsForListing(item) {
  if (item.isBatch) {
    const q = Number(item.quantity);
    return Number.isFinite(q) && q > 0 ? q : 0;
  }
  return 1;
}

/**
 * Build per-species availability projections, indexed two ways so callers can
 * join from either catalog shape:
 *   - `bySpeciesId`       — keyed by numeric speciesId (on-chain / contract).
 *   - `byScientificName`  — keyed by lowercased scientific name (the reliable
 *                           join for global/curated entries whose id is a
 *                           FishBase specCode, not an on-chain id).
 *
 * @param {Object[]} listings - merged marketplace listings
 * @returns {{ bySpeciesId: Map<number,Object>, byScientificName: Map<string,Object> }}
 */
export function buildSpeciesAvailability(listings = []) {
  const bySpeciesId = new Map();
  const byScientificName = new Map();

  const upsert = (map, key, item, units, cents, seller, lk) => {
    if (key == null || key === "") return;
    let agg = map.get(key);
    if (!agg) {
      agg = {
        speciesId: null,
        scientificName: null,
        commonName: null,
        listingCount: 0,
        unitsAvailable: 0,
        fromPriceCents: null,
        hasShipping: false,
        _sellers: new Set(),
        _keys: new Set(),
      };
      map.set(key, agg);
    }
    if (agg._keys.has(lk)) return; // de-dupe the same listing within this bucket
    agg._keys.add(lk);
    agg.listingCount += 1;
    agg.unitsAvailable += units;
    if (seller) agg._sellers.add(seller);
    if (Number.isFinite(cents) && cents > 0) {
      agg.fromPriceCents = agg.fromPriceCents == null ? cents : Math.min(agg.fromPriceCents, cents);
    }
    if (item.isShipping) agg.hasShipping = true;
    if (agg.speciesId == null && item.speciesId != null) agg.speciesId = Number(item.speciesId);
    if (!agg.scientificName && item.scientificName) agg.scientificName = item.scientificName;
    if (!agg.commonName && item.commonName) agg.commonName = item.commonName;
  };

  for (const item of Array.isArray(listings) ? listings : []) {
    if (!item || !isListingActive(item)) continue;
    const units = unitsForListing(item);
    if (units <= 0) continue; // active but out of stock

    const cents = normalizePriceCents(item);
    const seller = sellerKey(item);
    const lk = getListingKey(item);

    const idKey = item.speciesId != null ? Number(item.speciesId) : null;
    const nameKey = item.scientificName ? String(item.scientificName).toLowerCase() : null;

    upsert(bySpeciesId, idKey, item, units, cents, seller, lk);
    upsert(byScientificName, nameKey, item, units, cents, seller, lk);
  }

  const finalize = (map) => {
    for (const [k, agg] of map) {
      map.set(k, {
        speciesId: agg.speciesId,
        scientificName: agg.scientificName,
        commonName: agg.commonName,
        listingCount: agg.listingCount,
        sellerCount: agg._sellers.size,
        unitsAvailable: agg.unitsAvailable,
        fromPriceCents: agg.fromPriceCents,
        fromPriceDisplay: agg.fromPriceCents != null ? formatPriceCents(agg.fromPriceCents) : null,
        hasShipping: agg.hasShipping,
      });
    }
  };
  finalize(bySpeciesId);
  finalize(byScientificName);

  return { bySpeciesId, byScientificName };
}

/**
 * Look up the availability projection for a catalog entry, preferring the
 * numeric speciesId join and falling back to scientific name (so a curated
 * global entry, whose speciesId is a FishBase specCode, still matches on-chain
 * listings via its name).
 *
 * @param {{bySpeciesId:Map, byScientificName:Map}} index - buildSpeciesAvailability output
 * @param {{speciesId?:(number|string), scientificName?:string}} entry
 * @returns {Object|null} projection, or null when the species has no active listings
 */
export function getAvailabilityFor(index, entry) {
  if (!index || !entry) return null;
  if (entry.speciesId != null) {
    const hit = index.bySpeciesId.get(Number(entry.speciesId));
    if (hit) return hit;
  }
  const name = String(entry.scientificName || "").toLowerCase();
  if (name && index.byScientificName.has(name)) return index.byScientificName.get(name);
  return null;
}

/**
 * The canonical one-line availability string, e.g.
 *   "Available from 3 sellers · from $12.50"
 * Returns null when there is nothing to show (no active listings), so callers
 * can render a "not currently for sale" state instead. Omits the price clause
 * when no positive price is known.
 *
 * @param {Object|null} projection - getAvailabilityFor / bySpeciesId value
 * @returns {string|null}
 */
export function summarizeAvailability(projection) {
  if (!projection || projection.listingCount <= 0 || projection.sellerCount <= 0) return null;
  const sellers = `${projection.sellerCount} ${projection.sellerCount === 1 ? "seller" : "sellers"}`;
  const price =
    projection.fromPriceCents != null && projection.fromPriceCents > 0
      ? ` · from ${projection.fromPriceDisplay}`
      : "";
  return `Available from ${sellers}${price}`;
}

/**
 * Serialize an availability index into a public, key-by-scientific-name map
 * safe for anonymous exposure (Fish Finder Rework, Task 4c). This is the
 * privacy boundary: it whitelists ONLY aggregate fields — counts, from-price,
 * shipping flag, and display names — and deliberately drops any per-listing
 * detail and seller identity. (The projections already collapse sellers to a
 * `sellerCount`, but whitelisting here makes the public contract explicit so a
 * future projection field can't leak by default.)
 *
 * Keyed by lowercased scientific name because a public consumer (the species
 * database page) joins by name, not by the on-chain speciesId.
 *
 * @param {{byScientificName: Map<string,Object>}} index - buildSpeciesAvailability output
 * @returns {{ [scientificNameLower:string]: {
 *   scientificName:(string|null), commonName:(string|null), sellerCount:number,
 *   listingCount:number, unitsAvailable:number, fromPriceCents:(number|null),
 *   fromPriceDisplay:(string|null), hasShipping:boolean
 * } }}
 */
export function serializePublicAvailability(index) {
  const out = {};
  if (!index || !(index.byScientificName instanceof Map)) return out;
  for (const [name, p] of index.byScientificName) {
    if (!name || !p || p.listingCount <= 0 || p.sellerCount <= 0) continue;
    out[name] = {
      scientificName: p.scientificName ?? null,
      commonName: p.commonName ?? null,
      sellerCount: p.sellerCount,
      listingCount: p.listingCount,
      unitsAvailable: p.unitsAvailable,
      fromPriceCents: p.fromPriceCents,
      fromPriceDisplay: p.fromPriceDisplay,
      hasShipping: p.hasShipping,
    };
  }
  return out;
}
