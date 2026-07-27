/**
 * publicListingProjection.js — the field boundary for anonymously-readable
 * marketplace listings (Fish Finder Rework, Task 14 / Tier A).
 *
 * ## The problem this closes
 *
 * `aquadex_listings.data` is a JSON dump of the ENTIRE local Dexie listing
 * object (see `listingToRow` in cloudSync.js). Anonymous clients could `select
 * data` and receive all of it — including fields nobody ever decided to
 * publish: the seller's packing profile, health/DOA terms, the minimum-tank
 * note, and whatever a future listing wizard happens to add. The exposure was
 * **fail-open**: every new field a wizard writes became public the moment it
 * shipped, with no review step.
 *
 * This module is the fail-CLOSED replacement. `PUBLIC_LISTING_DATA_FIELDS` is
 * an explicit allowlist; anything not named here is not published, and adding a
 * field to the public surface is a deliberate edit to this file. It is the same
 * pattern (and the same reasoning) as `serializePublicAvailability` in
 * speciesAvailability.js, which drew the equivalent boundary for the aggregate
 * availability endpoint.
 *
 * ## What this is NOT
 *
 * This is not a claim that listings are secret. Listings are a public
 * storefront: price, species, and quantity are meant to be browsable while
 * logged out (that is what `marketplace.html` is for). Two honest notes:
 *
 *   - **`seller` / `seller_address` stays public.** It is already readable by
 *     anyone straight off the chain — `AquadexMarketplace.listings(tokenId)`
 *     returns the seller address to any RPC caller, and `marketplace.html`
 *     itself reads it that way. Stripping it from the Supabase projection while
 *     publishing it on-chain would buy no privacy, and three public surfaces
 *     key on it (storefront filtering, per-species breeder counts, breeder
 *     tier badges). A display name is exposed alongside it, not instead of it.
 *   - **There is no location field to fuzz.** Decision D3 removed fabricated
 *     seller coordinates at the source, so a listing carries no location at
 *     all. Real pickup coordinates live in `pickup_locations` and are revealed
 *     only order-scoped. If opt-in zone discovery (T15b) lands, its coarse
 *     metro zone gets added here deliberately.
 *
 * The value delivered is the boundary itself: bulk scraping now returns a
 * reviewed set of display fields instead of an unbounded blob.
 *
 * Pure and dependency-free.
 */

/**
 * The allowlisted keys of the listing `data` blob that may be exposed to
 * anonymous readers. Derived from what the public pages actually render:
 * `marketplace.html`, `species.html`, and `store.html`.
 *
 * KEEP IN SYNC with the `jsonb_build_object(...)` allowlist in
 * `supabase/migrations/20260728_aquadex_listings_public_view.sql`.
 * `publicListingProjection.test.js` parses that migration and fails if the two
 * ever drift, so the SQL view and this module cannot disagree about what is
 * public.
 */
export const PUBLIC_LISTING_DATA_FIELDS = Object.freeze([
  // Identity / routing
  "id",
  "tokenId",
  "listingId",
  "spawnId",
  "isBatch",
  "active",
  "createdAt",
  // Seller (public on-chain already — see the module note)
  "seller",
  // Species identity
  "speciesId",
  "commonName",
  "scientificName",
  // Lineage (already public on-chain; rendered as parentage badges)
  "sireId",
  "damId",
  // Commerce. Integer cents are the canonical money fields; `price` /
  // `shippingFee` are the display dollar strings the public pages read today.
  "price",
  "priceCentsUSD",
  "shippingFee",
  "shippingFeeCents",
  "isShipping",
  "quantity",
  // Care envelope shown on public cards
  "careLevel",
  "minTemp",
  "maxTemp",
  "minPh",
  "maxPh",
  // Card imagery
  "photoUrl",
]);

/**
 * Fields present in the stored blob that are deliberately NOT public. Listed
 * explicitly (rather than left implicit) so the intent is reviewable and so the
 * test can assert none of them survive the projection.
 *
 * These are withheld because they are seller operational detail or commercial
 * terms that belong to the logged-in purchase flow, not to an anonymous
 * scrape — not because they are secrets.
 */
export const WITHHELD_LISTING_DATA_FIELDS = Object.freeze([
  "packingProfile", // seller's box/bag operational config
  "description", // free text; unmoderated for anonymous display
  "healthStatus", // commercial claim, surfaced in the logged-in flow
  "doaGuarantee", // commercial term, surfaced in the logged-in flow
  "tankSizeMin", // seller's care note
  "age",
  "size",
  "diet",
  "temperament",
  "ipfsMetadataUri",
  "rawPrice", // redundant duplicate of `price`
  "priceUsd", // redundant duplicate of `price`
  "breederStockTag", // Pro/breeder-internal tag
]);

/**
 * Project one raw listing object down to its public shape.
 *
 * Allowlist semantics: a key absent from the input is absent from the output
 * (not emitted as `null`), so callers can distinguish "not provided" from
 * "provided as null" exactly as they do with the raw blob today.
 *
 * This is the JS mirror of the SQL view. The view is what actually protects the
 * data (it is what anon can read); this function exists so server-side and
 * in-app code paths can apply the identical boundary without duplicating the
 * field list.
 *
 * @param {Object|null|undefined} listing - raw listing object (Dexie/`data` shape)
 * @returns {Object} the public projection
 */
export function toPublicListing(listing) {
  const out = {};
  if (!listing || typeof listing !== "object") return out;
  for (const key of PUBLIC_LISTING_DATA_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(listing, key)) {
      out[key] = listing[key];
    }
  }
  return out;
}

/**
 * Project an array of raw listings, skipping non-objects.
 * @param {Array} listings
 * @returns {Object[]}
 */
export function toPublicListings(listings) {
  if (!Array.isArray(listings)) return [];
  return listings.filter((l) => l && typeof l === "object").map(toPublicListing);
}
