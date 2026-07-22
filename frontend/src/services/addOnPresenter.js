/**
 * addOnPresenter.js
 *
 * Thin, pure presentation adapter for the Task 11 UI (box-capacity meter +
 * safe add-on recommendation strip). Composes the already-built, Opus-
 * reviewed Tier A engines — `recommendAddOns`/`evaluateTankFit`
 * (addOnRecommender.js), `canAddToParcel`/`deriveDefaultPackingProfile`/
 * `normalizeParcelPreset` (packingEngine.js), `planParcels`
 * (parcelPlanner.js), and `normalizeSpeciesProfile` (shippingSafety.js) —
 * and shapes/labels their output for React. It contains NO threshold,
 * score formula, or box-count math of its own; see
 * docs/TASK_11_RECOMMENDATION_UI_SPEC.md §2/§1 ("do not fork or reimplement").
 *
 * Pure and dependency-free (besides the engines above, catalogQuery.js, and
 * orderCopy.js's PROHIBITED_TERMS invariant).
 */

import { deriveDefaultPackingProfile } from "./packingEngine.js";
import { planParcels } from "./parcelPlanner.js";
import { normalizeSpeciesProfile } from "./shippingSafety.js";
import { getListingKey, normalizePriceCents, isListingActive, formatPriceCents } from "./catalogQuery.js";

// ─── Candidate building ──────────────────────────────────────────────────────

/**
 * Build the `recommendAddOns` candidate array from a seller's live listings,
 * excluding whatever's already in the cart, inactive, or out of stock.
 *
 * @param {Object[]} sellerListings - the seller's listings (mixed on-chain/
 *   cloud/local shapes, same as catalogQuery.js elsewhere)
 * @param {Set<string>|string[]} cartItemKeys - listingKeys already in the cart
 * @param {Object} [speciesLookup] - { [scientificNameLower]: fishbase record },
 *   used to enrich a listing's bare min/max fields via normalizeSpeciesProfile
 * @returns {Array<{ listingId:string, speciesProfile:Object, packingProfile:(Object|undefined),
 *   quantityAvailable:number, priceCents:number, sellerBoost:number, _listing:Object }>}
 *   `_listing` carries the raw listing through for display joins in
 *   `presentRecommendation` — never read by the engine itself.
 */
export function buildCandidatesFromListings(sellerListings = [], cartItemKeys = [], speciesLookup = {}) {
  const excluded = cartItemKeys instanceof Set ? cartItemKeys : new Set(cartItemKeys || []);

  const candidates = [];
  for (const listing of sellerListings) {
    if (!listing) continue;
    if (!isListingActive(listing)) continue;

    const listingKey = getListingKey(listing);
    if (excluded.has(listingKey)) continue;

    const quantityAvailable = listing.isBatch ? Number(listing.quantity) || 0 : 1;
    if (quantityAvailable <= 0) continue;

    const nameKey = (listing.scientificName || "").toLowerCase();
    const speciesRecord = speciesLookup?.[nameKey] || {
      scientificName: listing.scientificName,
      commonName: listing.commonName,
      minTemp: listing.minTemp,
      maxTemp: listing.maxTemp,
      minPh: listing.minPh,
      maxPh: listing.maxPh,
    };
    const speciesProfile = normalizeSpeciesProfile(speciesRecord);

    candidates.push({
      listingId: listingKey,
      speciesProfile,
      packingProfile: listing.packingProfile || undefined,
      quantityAvailable,
      priceCents: normalizePriceCents(listing),
      sellerBoost: clamp01(Number(listing.sellerBoost) || (listing.isBoosted ? 1 : 0)),
      _listing: listing,
    });
  }
  return candidates;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

// ─── Box status (capacity meter) ────────────────────────────────────────────

/**
 * Resolve the packing profile of one cart item, the same way parcelPlanner
 * does internally (explicit profile, else derived from species+quantity) —
 * exposed here so this presenter's own `buildBoxStatus` (which needs the
 * per-item profile list for `canAddToParcel`) never re-derives the rule.
 * @param {Object} cartItem - a Task 10 CartItem, or any object exposing
 *   { packingProfile?, speciesProfile?, quantity? }
 * @returns {Object} a packing profile (packingEngine shape)
 */
export function resolveCartItemProfile(cartItem = {}) {
  if (cartItem.packingProfile) return cartItem.packingProfile;
  return deriveDefaultPackingProfile(cartItem.speciesProfile || {}, cartItem.quantity || 1);
}

/**
 * Derive the box-capacity status for the cart's current items.
 *
 * @param {Object[]} cartItems - cart items with { packingProfile?, speciesProfile?, quantity? }
 *   (i.e., already resolvable via resolveCartItemProfile / parcelPlanner.planParcels)
 * @param {Object} preset - normalizeParcelPreset output
 * @returns {{ parcels:number, usage:Object, remaining:Object, fillPercent:number, bindingConstraint:string }}
 */
export function buildBoxStatus(cartItems = [], preset) {
  const plan = planParcels(cartItems, preset);
  const remaining = plan.remainingInLastBoxSet;

  // Per-constraint fill ratio (usage / one box's capacity), clamped 0-100.
  // The binding constraint (highest ratio) drives the headline number —
  // mirrors the same reasoning packingEngine.boxesRequired uses internally
  // (max across weight/bags/volume/livestock), just expressed as a percent
  // instead of a box count.
  const ratios = {
    weight: preset.usableWeightOz > 0 ? plan.usage.weightOz / preset.usableWeightOz : 0,
    bags: preset.maxBags > 0 ? plan.usage.bags / preset.maxBags : 0,
    volume: preset.usableVolumeIn3 > 0 ? plan.usage.volumeIn3 / preset.usableVolumeIn3 : 0,
    livestock: preset.maxLivestock > 0 ? plan.usage.livestock / preset.maxLivestock : 0,
  };

  // Ratios are per-single-box; once the order already spans multiple boxes,
  // express fill against the LAST (partially-filled) box only — the meter
  // shows "how full is the box you're currently filling," not a cumulative
  // total that would nonsensically exceed 100% for the first N-1 full boxes.
  const perBoxRatios = plan.parcels > 1
    ? {
        weight: fractionalRemainder(ratios.weight),
        bags: fractionalRemainder(ratios.bags),
        volume: fractionalRemainder(ratios.volume),
        livestock: fractionalRemainder(ratios.livestock),
      }
    : ratios;

  let bindingConstraint = "weight";
  let maxRatio = -Infinity;
  for (const [key, ratio] of Object.entries(perBoxRatios)) {
    if (ratio > maxRatio) {
      maxRatio = ratio;
      bindingConstraint = key;
    }
  }

  const fillPercent = Math.max(0, Math.min(100, Math.round(maxRatio * 100)));

  return {
    parcels: plan.parcels,
    usage: plan.usage,
    remaining,
    fillPercent,
    bindingConstraint,
  };
}

/** The fractional part of a ratio > 1 (i.e. how full the LAST box is), else the ratio itself. */
function fractionalRemainder(ratio) {
  if (ratio <= 1) return ratio;
  const frac = ratio % 1;
  return frac === 0 ? 1 : frac;
}

// ─── Recommendation join (display fields, preserving engine order) ─────────

/**
 * Join `recommendAddOns` ranked output back to display fields, preserving
 * the engine's exact ranking — this function does not re-sort or re-score.
 *
 * @param {Array} ranked - recommendAddOns(...) output
 * @param {Object[]} candidates - the SAME candidates array passed into
 *   recommendAddOns (carries `_listing` for display fields)
 * @returns {Array<{ listingId, commonName, scientificName, priceCents, priceDisplay,
 *   imageUrl, quantityAvailable, addedBox:boolean, tankFitVerdict:string,
 *   topReason:(string|null), raw:Object }>}
 */
export function presentRecommendation(ranked = [], candidates = []) {
  const byId = new Map(candidates.map((c) => [c.listingId, c]));

  return ranked.map((row) => {
    const candidate = byId.get(row.listingId);
    const listing = candidate?._listing || {};
    return {
      listingId: row.listingId,
      commonName: listing.commonName || "",
      scientificName: listing.scientificName || "",
      priceCents: candidate?.priceCents ?? 0,
      priceDisplay: formatPriceCents(candidate?.priceCents ?? 0),
      imageUrl: listing.imageUrl || listing.photoUrl || null,
      quantityAvailable: candidate?.quantityAvailable ?? 0,
      isBatch: !!listing.isBatch,
      addedBox: row.boxFit?.addedBox === true,
      tankFitVerdict: row.tankFit?.verdict || "caution",
      topReason: row.reasons?.[0] || null,
      raw: listing,
    };
  });
}

// ─── Copy (Web2-safe, casual/pro) ────────────────────────────────────────────

/**
 * Plain-language line for the box-capacity meter, matching the binding
 * constraint. Never fabricates precision the engine didn't produce — the
 * "room for X more" estimate only appears when remaining livestock capacity
 * is known and positive.
 * @param {{ parcels:number, remaining:Object, bindingConstraint:string }} boxStatus
 * @param {{ casual?: boolean }} [opts]
 * @returns {string}
 */
export function capacityCopy(boxStatus, opts = {}) {
  const casual = opts.casual !== false;
  const { parcels, remaining } = boxStatus;

  if (parcels > 1) {
    return casual
      ? `This order ships in ${parcels} boxes`
      : `Order requires ${parcels} parcels`;
  }

  const roomForMore = Number(remaining?.livestock);
  if (Number.isFinite(roomForMore) && roomForMore > 0) {
    return casual
      ? `Room for a few more — no extra shipping`
      : `Capacity remaining for up to ${roomForMore} more`;
  }

  if (Number.isFinite(roomForMore) && roomForMore <= 0) {
    return casual ? "Your box is full" : "Box at capacity";
  }

  return casual ? "This order ships in one box" : "Single parcel";
}

/**
 * Plain-language line(s) for one add-on recommendation card: the box signal
 * (primary) and the tank-fit signal (secondary), each Web2-safe.
 * @param {{ addedBox:boolean, tankFitVerdict:string, hasBuyerTank?:boolean }} row
 * @param {{ casual?: boolean }} [opts]
 * @returns {{ boxLabel:string, tankFitLabel:(string|null) }}
 */
export function addOnCopy(row, opts = {}) {
  const casual = opts.casual !== false;

  const boxLabel = row.addedBox
    ? (casual ? "Adds a box — extra shipping at checkout" : "Adds a parcel (+shipping)")
    : (casual ? "Fits your box — no extra shipping" : "No additional parcel required");

  let tankFitLabel = null;
  if (row.hasBuyerTank === false) {
    tankFitLabel = casual ? "Select a tank to check fit" : "Tank fit unknown — select a tank";
  } else if (row.tankFitVerdict === "ok") {
    tankFitLabel = casual ? "Great fit for your tank" : "Compatible with selected tank";
  } else if (row.tankFitVerdict === "caution") {
    tankFitLabel = casual ? "Double-check tank fit" : "Review tank compatibility";
  }

  return { boxLabel, tankFitLabel };
}
