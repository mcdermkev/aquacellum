/**
 * productDetailView.js
 *
 * Product-detail view-model assembler (Task 8, Tier B). `assembleProductDetailView`
 * takes a raw listing, its matched species reference record, and buyer/seller
 * context, and returns a single normalized object the detail UI renders —
 * care requirements, the compatibility explanation, normalized pricing, seller
 * policies (incl. the DOA window), fulfillment options with a local-delivery
 * estimate, and a reviews slot.
 *
 * Composes, never re-derives:
 *   - `normalizeSpeciesProfile` (shippingSafety.js) for care requirements
 *   - `buildCompatibilityExplanation` (compatibilityExplanation.js), which
 *     itself composes `evaluateTankFit`
 *   - `evaluateDeliveryEligibility` (deliveryEligibility.js) for the local
 *     delivery verdict
 *   - `normalizePriceCents` / `formatPriceCents` / `getFulfillmentTypes`
 *     (catalogQuery.js) for pricing + fulfillment
 *   - `DEFAULT_CLAIM_WINDOW_MS` (doaClaims.js) for the platform-minimum DOA
 *     window, taking the max with any seller-offered window (never less than
 *     the platform minimum — same rule doaClaims.js itself encodes)
 *
 * Pure and dependency-free beyond those existing modules. See
 * docs/TASK_08_CATALOG_SPEC.md §2. Reviews are a display-only slot; the
 * reviews backend is Task 20 — this module never fetches or scores reviews.
 */

import { normalizeSpeciesProfile } from "./shippingSafety.js";
import { buildCompatibilityExplanation } from "./compatibilityExplanation.js";
import { evaluateDeliveryEligibility } from "./deliveryEligibility.js";
import { normalizePriceCents, formatPriceCents, getFulfillmentTypes, FULFILLMENT_TYPES } from "./catalogQuery.js";
import { DEFAULT_CLAIM_WINDOW_MS } from "./doaClaims.js";

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Assemble the normalized product-detail view model.
 *
 * @param {Object} listing - a raw marketplace listing (single or batch)
 * @param {Object} [speciesRecord] - the matched fishbase_master.json record
 *   (or any record shape normalizeSpeciesProfile accepts); may be undefined
 *   if no species match was found, in which case care requirements/species
 *   profile fall back to listing-derived fields only
 * @param {Object} [ctx]
 * @param {{volume:number, temp:number, ph:number}|null} [ctx.displayTank]
 * @param {Object} [ctx.deliveryContext] - passed straight through to
 *   evaluateDeliveryEligibility (seller/provider/packaging/conditions/window)
 * @param {Object[]} [ctx.reviews] - existing review records to display, if any
 * @param {Object} [ctx.sellerPolicy] - { doaWindowHours?, returnPolicy? }
 * @returns {Object} normalized product detail view model
 */
export function assembleProductDetailView(listing = {}, speciesRecord, ctx = {}) {
  // Merge the species reference record with listing-derived fallback fields
  // (mirrors the shape normalizeSpeciesProfile already accepts) so a listing
  // with no fishbase match still gets a usable, if less confident, profile.
  const mergedRecord = {
    ...(speciesRecord || {}),
    scientificName: speciesRecord?.scientificName || listing.scientificName,
    commonName: speciesRecord?.commonName || listing.commonName,
    minTemp: speciesRecord?.minTemp ?? listing.minTemp,
    maxTemp: speciesRecord?.maxTemp ?? listing.maxTemp,
    minPh: speciesRecord?.minPh ?? listing.minPh,
    maxPh: speciesRecord?.maxPh ?? listing.maxPh,
  };
  const speciesProfile = normalizeSpeciesProfile(mergedRecord);

  const careRequirements = buildCareRequirements(speciesProfile, listing, speciesRecord);
  const compatibility = buildCompatibilityExplanation(speciesProfile, ctx.displayTank || null);

  const priceCents = normalizePriceCents(listing);

  return {
    listingId: listing.isBatch ? listing.listingId : listing.tokenId,
    isBatch: !!listing.isBatch,
    identity: {
      commonName: listing.commonName || speciesProfile.commonName || "Unknown Species",
      scientificName: listing.scientificName || speciesProfile.scientificName || null,
      speciesId: listing.speciesId ?? speciesProfile.speciesId ?? null,
    },
    price: {
      cents: priceCents,
      display: formatPriceCents(priceCents),
      isPerFish: !!listing.isBatch,
    },
    careRequirements,
    compatibility,
    sellerPolicies: buildSellerPolicies(listing, ctx.sellerPolicy),
    fulfillment: buildFulfillmentOptions(listing, ctx.deliveryContext),
    reviews: buildReviewsSlot(ctx.reviews),
  };
}

// ─── Care requirements ──────────────────────────────────────────────────────

function buildCareRequirements(speciesProfile, listing, speciesRecord) {
  return {
    minTankSizeGallons: speciesProfile.minVolumeGallons ?? null,
    temperatureRangeCelsius: speciesProfile.tempRange,
    phRange: speciesProfile.phRange,
    adultSizeCm: speciesProfile.adultSizeCm,
    temperament: speciesProfile.temperament?.value ?? "unknown",
    careLevel: listing.careLevel ?? speciesRecord?.careLevel ?? null,
    diet: listing.diet ?? speciesRecord?.diet?.fooditems ?? null,
    dataConfidence: speciesProfile.dataConfidence,
  };
}

// ─── Seller policies (incl. DOA window) ─────────────────────────────────────

/**
 * The platform-minimum DOA claim window (doaClaims.js's
 * DEFAULT_CLAIM_WINDOW_MS) always applies; a seller may offer a *longer*
 * window but never a shorter one — same floor rule doaClaims.js itself
 * enforces, applied here at display time so buyers never see a promise the
 * platform wouldn't honor.
 */
function buildSellerPolicies(listing, sellerPolicy = {}) {
  const platformMinHours = DEFAULT_CLAIM_WINDOW_MS / MS_PER_HOUR;
  const sellerOfferedHours = Number(sellerPolicy.doaWindowHours);
  const doaWindowHours = Number.isFinite(sellerOfferedHours)
    ? Math.max(sellerOfferedHours, platformMinHours)
    : platformMinHours;

  return {
    doaGuarantee: listing.doaGuarantee !== false,
    doaWindowHours,
    healthStatus: listing.healthStatus || "healthy",
    returnPolicy: sellerPolicy.returnPolicy || null,
  };
}

// ─── Fulfillment options + local delivery estimate ──────────────────────────

function buildFulfillmentOptions(listing, deliveryContext) {
  const types = getFulfillmentTypes(listing);
  const supportsLocalDelivery = types.includes(FULFILLMENT_TYPES.LOCAL_DELIVERY);

  let localDelivery = null;
  if (supportsLocalDelivery && deliveryContext) {
    const eligibility = evaluateDeliveryEligibility(deliveryContext);
    localDelivery = {
      available: eligibility.eligibleNow,
      verdict: eligibility.verdict,
      summary:
        eligibility.verdict === "eligible"
          ? "Local delivery available"
          : eligibility.verdict === "reschedule"
            ? "Local delivery possible at a different time — pickup available now"
            : "Pickup only — local delivery isn't safe for this order",
      reasons: [...eligibility.blockers, ...eligibility.timingIssues].map((r) => r.message),
    };
  }

  return {
    types,
    shipping: types.includes(FULFILLMENT_TYPES.SHIPPING),
    pickup: types.includes(FULFILLMENT_TYPES.PICKUP),
    localDelivery,
  };
}

// ─── Reviews (display-only slot; backend is Task 20) ────────────────────────

function buildReviewsSlot(reviews) {
  const list = Array.isArray(reviews) ? reviews : [];
  const count = list.length;
  const averageRating =
    count > 0 ? list.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / count : null;

  return {
    count,
    averageRating,
    items: list,
  };
}
