/**
 * catalogQuery.js
 *
 * Unified catalog query engine (Task 8, Tier B). Pure and deterministic:
 * `applyCatalogQuery(listings, query)` takes the raw, mixed-shape listing
 * array (on-chain specimens, batch listings, cloud/local listings) and a
 * query object, and returns the filtered/searched/sorted results plus facet
 * counts for the filter UI.
 *
 * This module does NOT re-derive compatibility, pricing, or delivery rules —
 * see docs/TASK_08_CATALOG_SPEC.md §1. Compatibility sorting composes
 * `evaluateTankFit` from addOnRecommender.js; price normalization is the one
 * piece of logic that legitimately lives here (listings arrive in several
 * different price shapes and every other module expects integer cents).
 */

import Fuse from "fuse.js";
import { evaluateTankFit } from "./addOnRecommender.js";

// ─── Price normalization (the shared cents helper) ─────────────────────────

/**
 * Normalize a listing's price to integer USD cents, regardless of which
 * shape it arrived in:
 *   - priceCentsUSD / pricePerFishCents (already cents, on-chain shape)
 *   - priceUsd / price (decimal-dollar strings/numbers, display shape)
 * @param {Object} item
 * @returns {number} integer cents (0 if unparseable)
 */
export function normalizePriceCents(item = {}) {
  if (Number.isFinite(item.priceCentsUSD)) return Math.round(item.priceCentsUSD);
  if (Number.isFinite(item.pricePerFishCents)) return Math.round(item.pricePerFishCents);
  const dollars = item.priceUsd ?? item.price;
  const parsed = parseFloat(dollars);
  if (Number.isFinite(parsed)) return Math.round(parsed * 100);
  return 0;
}

/**
 * Render a cents value as a USD display string. The single shared formatter
 * referenced by the spec so catalog cards and product detail render prices
 * identically regardless of the listing's original price shape.
 * @param {number} cents
 * @returns {string} e.g. "$12.50"
 */
export function formatPriceCents(cents) {
  const safe = Number.isFinite(cents) ? cents : 0;
  return `$${(safe / 100).toFixed(2)}`;
}

// ─── Listing identity + activity ────────────────────────────────────────────

/**
 * A stable, deterministic identifier for a listing, unique across both
 * batch and single listings (which otherwise use independent id sequences).
 * @param {Object} item
 * @returns {string}
 */
export function getListingKey(item = {}) {
  return item.isBatch ? `batch-${item.listingId ?? item.id}` : `single-${item.tokenId ?? item.id}`;
}

/** Strict parser for identities that are allowed to cross a commerce boundary. */
export function parseListingKey(value) {
  const match = /^(single|batch)-([1-9]\d*)$/.exec(String(value || ""));
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id)) return null;
  return { key: `${match[1]}-${id}`, id, isBatch: match[1] === "batch" };
}

/** Return a canonical key only when the listing has a valid positive integer id. */
export function getCanonicalListingKey(item = {}) {
  const rawId = item.isBatch ? (item.listingId ?? item.id) : (item.tokenId ?? item.id);
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return `${item.isBatch ? "batch" : "single"}-${id}`;
}

/**
 * Resolve one requested checkout line against a specifically authoritative
 * catalog row. This is presentation/recovery validation only; the Stripe API
 * remains the final authority for price, inventory, seller and buyer binding.
 */
export function resolveCheckoutListing({
  listingKey,
  quantity = 1,
  expectedSeller = null,
  listingsByKey,
  authoritativeKeys,
} = {}) {
  const parsed = parseListingKey(listingKey);
  if (!parsed) return { eligible: false, reason: "This checkout link is not valid." };
  if (!(listingsByKey instanceof Map) || !(authoritativeKeys instanceof Set) || !authoritativeKeys.has(parsed.key)) {
    return { eligible: false, reason: "Live availability for this listing could not be verified." };
  }

  const listing = listingsByKey.get(parsed.key);
  if (!listing || getCanonicalListingKey(listing) !== parsed.key || !!listing.isBatch !== parsed.isBatch) {
    return { eligible: false, reason: "This listing is no longer available." };
  }
  if (!isListingActive(listing)) {
    return { eligible: false, reason: "This listing is no longer active." };
  }

  const seller = String(listing.seller || listing.sellerAddress || "").trim().toLowerCase();
  if (!seller) return { eligible: false, reason: "The listing seller could not be verified." };
  if (expectedSeller && seller !== String(expectedSeller).trim().toLowerCase()) {
    return { eligible: false, reason: "The listing seller changed. Review your cart before checkout." };
  }

  const requested = Number(quantity);
  if (!Number.isSafeInteger(requested) || requested <= 0 || (!parsed.isBatch && requested !== 1)) {
    return { eligible: false, reason: "The requested quantity is not valid." };
  }
  const available = parsed.isBatch
    ? Number(listing.quantityRemaining ?? listing.quantity)
    : 1;
  if (!Number.isFinite(available) || available < requested || available <= 0) {
    return { eligible: false, reason: "The requested quantity is no longer available." };
  }

  return { eligible: true, listing, listingKey: parsed.key, quantity: requested, seller };
}

/**
 * Ascending, deterministic comparator over listing keys (type-prefixed, then
 * numeric where possible, else lexicographic). Used as the tiebreak for every
 * sort so identical inputs always produce identical output order.
 */
function compareListingKeys(a, b) {
  const ka = getListingKey(a);
  const kb = getListingKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * A listing is active unless explicitly marked otherwise. Batch listings use
 * `isActive`; single/cloud/local listings use `active`. Absence of the flag
 * means active (fetchListingsByBreed only returns already-active on-chain
 * listings, so most items simply won't carry the flag at all).
 *
 * Exported (Task 10) so cart revalidation can reuse this exact rule rather
 * than re-deriving active/inactive status.
 * @param {Object} item
 * @returns {boolean}
 */
export function isListingActive(item) {
  if (item.isBatch) return item.isActive !== false;
  return item.active !== false;
}

// ─── Fulfillment classification ─────────────────────────────────────────────

export const FULFILLMENT_TYPES = Object.freeze({
  SHIPPING: "shipping",
  PICKUP: "pickup",
  LOCAL_DELIVERY: "local_delivery",
});

/**
 * Which fulfillment types a listing supports. Pickup is the universal
 * fallback (always available unless a listing explicitly opts out); shipping
 * and local delivery are additive based on listing flags.
 * @param {Object} item
 * @returns {string[]}
 */
export function getFulfillmentTypes(item = {}) {
  const types = [];
  if (item.isShipping) types.push(FULFILLMENT_TYPES.SHIPPING);
  if (item.localDeliveryAvailable) types.push(FULFILLMENT_TYPES.LOCAL_DELIVERY);
  if (item.pickupAvailable !== false) types.push(FULFILLMENT_TYPES.PICKUP);
  return types;
}

// ─── Family resolution (species/family filter) ──────────────────────────────

/**
 * Resolve a listing's taxonomic family. Some listings (cloud-synced ones)
 * carry `family` directly; otherwise fall back to a caller-supplied lookup
 * keyed by speciesId or lowercased scientific name (e.g. derived from the
 * fishbase master catalog), so the pure module never needs its own copy of
 * species reference data.
 * @param {Object} item
 * @param {Object} [familyLookup]
 * @returns {string|null}
 */
function resolveFamily(item, familyLookup) {
  if (item.family) return item.family;
  if (!familyLookup) return null;
  const byId = familyLookup[item.speciesId];
  if (byId) return byId;
  const nameKey = (item.scientificName || "").toLowerCase();
  return familyLookup[nameKey] ?? null;
}

// ─── Compatibility sort adapter ─────────────────────────────────────────────

/**
 * Adapt a listing into the species-profile shape evaluateTankFit expects,
 * sourcing the minimum tank volume from a caller-supplied lookup (the same
 * `{ scientificName.toLowerCase(): tankMetrics }` shape MarketplaceBoard
 * already builds from the fishbase catalog).
 */
function toCompatibilityProfile(item, speciesLookup) {
  const nameKey = (item.scientificName || "").toLowerCase();
  const metrics = speciesLookup ? speciesLookup[nameKey] : undefined;
  return {
    minVolumeGallons: metrics?.minVolumeGallons ?? undefined,
    tempRange: item.minTemp != null && item.maxTemp != null ? [item.minTemp, item.maxTemp] : null,
    phRange: item.minPh != null && item.maxPh != null ? [item.minPh, item.maxPh] : null,
  };
}

// ─── Sort ────────────────────────────────────────────────────────────────────

export const SORT_OPTIONS = Object.freeze({
  PRICE_ASC: "price_asc",
  PRICE_DESC: "price_desc",
  COMPATIBILITY: "compatibility",
  DISTANCE: "distance",
  NEWEST: "newest",
});

function getListingTimestamp(item) {
  // `birthTimestamp` is 0 when the birth date is UNKNOWN, which is the common case
  // for bought-in stock. `??` only falls through on null/undefined, so a stored 0
  // was kept and the listing sorted as the oldest thing in the catalogue under
  // NEWEST — unknown-age fish sank to the bottom of a "newest first" view.
  //
  // Treating 0 as absent restores the intended precedence. Note this must NOT
  // become `||` on the whole chain: a legitimately falsy `createdAt` of 0 would
  // have the same problem one link down, so each candidate is checked explicitly.
  const candidates = [item.birthTimestamp, item.createdAt, item.listedAt];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return -Infinity;
}

function getListingDistance(item) {
  const d = item.distanceMiles;
  return Number.isFinite(Number(d)) ? Number(d) : Infinity;
}

function applySort(results, query) {
  const sorted = [...results];

  switch (query.sort) {
    case SORT_OPTIONS.PRICE_ASC:
      sorted.sort((a, b) => normalizePriceCents(a) - normalizePriceCents(b) || compareListingKeys(a, b));
      break;
    case SORT_OPTIONS.PRICE_DESC:
      sorted.sort((a, b) => normalizePriceCents(b) - normalizePriceCents(a) || compareListingKeys(a, b));
      break;
    case SORT_OPTIONS.COMPATIBILITY: {
      const displayTank = query.displayTank || null;
      const scoreOf = (item) => evaluateTankFit(toCompatibilityProfile(item, query.speciesLookup), displayTank).score;
      sorted.sort((a, b) => scoreOf(b) - scoreOf(a) || compareListingKeys(a, b));
      break;
    }
    case SORT_OPTIONS.DISTANCE:
      sorted.sort((a, b) => getListingDistance(a) - getListingDistance(b) || compareListingKeys(a, b));
      break;
    case SORT_OPTIONS.NEWEST:
      sorted.sort((a, b) => getListingTimestamp(b) - getListingTimestamp(a) || compareListingKeys(a, b));
      break;
    default:
      // No sort requested: preserve input order but keep the tiebreak
      // available for callers that want fully deterministic output anyway.
      break;
  }

  return sorted;
}

// ─── Search ─────────────────────────────────────────────────────────────────

const SEARCH_KEYS = Object.freeze([
  { name: "commonName", weight: 0.8 },
  { name: "scientificName", weight: 0.7 },
]);
const SEARCH_THRESHOLD = 0.35;

function applySearch(items, searchTerm) {
  const term = (searchTerm || "").trim();
  if (!term) return items;
  if (items.length === 0) return items;
  const fuse = new Fuse(items, { keys: SEARCH_KEYS, threshold: SEARCH_THRESHOLD, ignoreLocation: true });
  return fuse.search(term).map((r) => r.item);
}

// ─── Facets ─────────────────────────────────────────────────────────────────

/**
 * Compute facet counts (family / care level / fulfillment type) over a set
 * of listings. Counts reflect exactly the given set, so callers get facets
 * for either the fully-filtered result set or an intermediate one depending
 * on the UX they want (the catalog UI uses the post-filter, post-search set).
 */
function computeFacets(items, familyLookup) {
  const family = {};
  const careLevel = {};
  const fulfillmentType = {};

  for (const item of items) {
    const fam = resolveFamily(item, familyLookup);
    if (fam) family[fam] = (family[fam] || 0) + 1;

    if (item.careLevel != null) {
      const cl = Number(item.careLevel);
      careLevel[cl] = (careLevel[cl] || 0) + 1;
    }

    for (const type of getFulfillmentTypes(item)) {
      fulfillmentType[type] = (fulfillmentType[type] || 0) + 1;
    }
  }

  return { family, careLevel, fulfillmentType };
}

// ─── The query entry point ──────────────────────────────────────────────────

/**
 * Apply a catalog query to a raw listing array.
 *
 * @param {Object[]} listings
 * @param {Object} [query]
 * @param {boolean} [query.includeInactive=false] - keep inactive/sold listings
 * @param {string} [query.search] - fuzzy search over common + scientific name
 * @param {number} [query.speciesId] - exact species filter
 * @param {string} [query.family] - exact family filter (see familyLookup)
 * @param {Object} [query.familyLookup] - { [speciesId|scientificNameLower]: family }
 * @param {number} [query.careLevel] - exact care-level filter
 * @param {number} [query.priceMinCents]
 * @param {number} [query.priceMaxCents]
 * @param {string} [query.fulfillment] - one of FULFILLMENT_TYPES
 * @param {('batch'|'single')} [query.listingType]
 * @param {string} [query.sort] - one of SORT_OPTIONS
 * @param {{volume:number, temp:number, ph:number}} [query.displayTank] - required for COMPATIBILITY sort
 * @param {Object} [query.speciesLookup] - { [scientificNameLower]: { minVolumeGallons } }, for COMPATIBILITY sort
 * @returns {{ results: Object[], facets: { family: Object, careLevel: Object, fulfillmentType: Object } }}
 */
export function applyCatalogQuery(listings = [], query = {}) {
  const familyLookup = query.familyLookup;

  let filtered = listings.filter((item) => {
    if (!query.includeInactive && !isListingActive(item)) return false;

    if (query.listingType === "batch" && !item.isBatch) return false;
    if (query.listingType === "single" && item.isBatch) return false;

    if (query.speciesId != null && Number(item.speciesId) !== Number(query.speciesId)) return false;

    if (query.family) {
      const fam = resolveFamily(item, familyLookup);
      if (fam !== query.family) return false;
    }

    if (query.careLevel != null && Number(item.careLevel) !== Number(query.careLevel)) return false;

    if (query.priceMinCents != null || query.priceMaxCents != null) {
      const cents = normalizePriceCents(item);
      if (query.priceMinCents != null && cents < query.priceMinCents) return false;
      if (query.priceMaxCents != null && cents > query.priceMaxCents) return false;
    }

    if (query.fulfillment && query.fulfillment !== "any") {
      if (!getFulfillmentTypes(item).includes(query.fulfillment)) return false;
    }

    return true;
  });

  filtered = applySearch(filtered, query.search);

  const facets = computeFacets(filtered, familyLookup);
  const results = applySort(filtered, query);

  return { results, facets };
}
