/**
 * listingDraft.js
 *
 * Assisted-listing auto-populate core (Task 9 Increment 2, Tier B). Pure and
 * deterministic — no network, no randomness. Composes the already-built,
 * Opus-reviewed engines rather than re-deriving anything:
 *   - normalizeSpeciesProfile (shippingSafety.js) for structured care facts
 *   - deriveDefaultPackingProfile (packingEngine.js) for the packing profile
 *   - buildCompatibilityExplanation (compatibilityExplanation.js) for the
 *     exact buyer-facing compatibility verdict/copy
 *   - normalizePriceCents / isListingActive (catalogQuery.js) for comparable
 *     pricing
 *
 * See docs/TASK_09_INC2_LISTING_FLOW_SPEC.md §2.1 for the authoritative spec.
 *
 * `groundingFacts` is the anti-fabrication guarantee at the data layer: it is
 * a hand-picked whitelist of sanitized care/name/origin facts, never the raw
 * record, and it never includes health status, DOA/guarantee language,
 * lineage/pedigree, or pricing. Only these facts may ever be handed to
 * Poseidon for a listing-description draft (see api/ai.js's
 * `listing_description` intent) — an Opus review gate applies to that wiring
 * specifically because it's the one place fabricated care/health/guarantee
 * claims could leak into buyer-facing copy.
 */

import { normalizeSpeciesProfile } from "./shippingSafety.js";
import { deriveDefaultPackingProfile } from "./packingEngine.js";
import { buildCompatibilityExplanation } from "./compatibilityExplanation.js";
import { normalizePriceCents, isListingActive } from "./catalogQuery.js";

// ─── Care level (informational only — not a safety input) ──────────────────

const DIFFICULTY_TO_CARE_LEVEL = Object.freeze({
  beginner: 0,
  easy: 0,
  intermediate: 1,
  moderate: 1,
  advanced: 2,
  expert: 2,
  hard: 2,
});

/**
 * Resolve a 0-2 care level from whatever shape the species record carries:
 * an explicit numeric careLevel (on-chain catalog / listing shape) wins;
 * otherwise fall back to a free-text difficulty label (fishbase shape).
 * Never fabricated — returns null when nothing is present.
 */
function resolveCareLevel(record = {}) {
  if (record.careLevel != null && Number.isFinite(Number(record.careLevel))) {
    return Number(record.careLevel);
  }
  const label = record.tankMetrics?.difficulty ?? record.difficulty;
  if (!label) return null;
  const mapped = DIFFICULTY_TO_CARE_LEVEL[String(label).toLowerCase()];
  return mapped != null ? mapped : null;
}

/** Resolve a diet description string, or null when the record has none. */
function resolveDietText(record = {}) {
  return record.diet?.fooditems || record.diet?.trophicLevel || null;
}

/** Resolve a general origin/biotope description, or null. Descriptive only. */
function resolveOrigin(record = {}) {
  return record.ecology?.biotope || null;
}

// ─── Draft builder ───────────────────────────────────────────────────────────

/**
 * Build the seller's auto-populated listing draft from a species record.
 *
 * @param {Object} speciesRecord - a fishbase_master.json record, an
 *   on-chain catalog record (useContractSpecies shape), or any object
 *   exposing the fields normalizeSpeciesProfile reads.
 * @param {Object} [opts]
 * @param {number} [opts.quantity=1] - listing quantity (batch listings)
 * @param {{volume:number, temp:number, ph:number}|null} [opts.displayTank] -
 *   optional tank context for a live compatibility preview (e.g. the
 *   seller's own tank); omitted/null yields the engine's own "select a
 *   tank" placeholder — never fabricated, never blocked on missing data.
 * @param {Object[]} [opts.comparables] - active same-species listings, for
 *   an optional price suggestion (see buildPriceSuggestion below). Omit to
 *   skip pricing entirely.
 * @param {number} [opts.sampleFloor] - forwarded to buildPriceSuggestion.
 * @returns {{
 *   care: Object,
 *   compatibilityPreview: Object,
 *   packingProfile: Object,
 *   groundingFacts: Object,
 *   priceSuggestion: (Object|null),
 *   suggestedPriceCents: (number|undefined)
 * }}
 */
export function buildListingDraftFromSpecies(speciesRecord = {}, opts = {}) {
  const quantity = Math.max(1, Math.round(Number(opts.quantity) || 1));
  const normalized = normalizeSpeciesProfile(speciesRecord);

  const careLevel = resolveCareLevel(speciesRecord);
  const diet = resolveDietText(speciesRecord);

  const care = Object.freeze({
    minVolumeGallons: normalized.minVolumeGallons,
    tempRangeCelsius: normalized.tempRange,
    phRange: normalized.phRange,
    adultSizeCm: normalized.adultSizeCm,
    temperament: normalized.temperament.value,
    careLevel,
    diet,
    dataConfidence: Object.freeze({
      minVolumeGallons: normalized.minVolumeGallons != null,
      tempRangeCelsius: normalized.dataConfidence.temp,
      phRange: normalized.dataConfidence.ph,
      adultSizeCm: normalized.dataConfidence.size,
      temperament: normalized.dataConfidence.temperament,
      careLevel: careLevel != null,
      diet: diet != null,
    }),
  });

  // Buyer-parity preview — composes the exact engine buyers see. With no
  // tank context this deterministically returns the "select a tank"
  // placeholder shape (never fabricated, never a false "ok").
  const compatibilityPreview = buildCompatibilityExplanation(normalized, opts.displayTank || null);

  // Packing profile — seller-editable starting point, from the same engine
  // the cart/checkout capacity math uses.
  const packingProfile = deriveDefaultPackingProfile(normalized, quantity);

  // The anti-fabrication whitelist. Only these keys may ever reach Poseidon
  // for a listing-description draft.
  const groundingFacts = Object.freeze({
    commonName: normalized.commonName || speciesRecord.commonName || null,
    scientificName: normalized.scientificName || speciesRecord.scientificName || null,
    adultSizeCm: care.adultSizeCm,
    temperament: care.temperament,
    tempRangeCelsius: care.tempRangeCelsius,
    phRange: care.phRange,
    minVolumeGallons: care.minVolumeGallons,
    careLevel: care.careLevel,
    diet: care.diet,
    origin: resolveOrigin(speciesRecord),
  });

  const result = { care, compatibilityPreview, packingProfile, groundingFacts, priceSuggestion: null };

  if (Array.isArray(opts.comparables) && opts.comparables.length > 0) {
    const speciesId = opts.speciesId != null ? opts.speciesId : normalized.speciesId;
    const suggestion = buildPriceSuggestion(opts.comparables, speciesId, { sampleFloor: opts.sampleFloor });
    result.priceSuggestion = suggestion;
    if (suggestion) result.suggestedPriceCents = suggestion.suggestedCents;
  }

  return result;
}

// ─── Price suggestion ────────────────────────────────────────────────────────

const DEFAULT_PRICE_SAMPLE_FLOOR = 3;

/**
 * Suggest a listing price from comparable active same-species listings.
 * Never a promise — a hint. Returns null below the sample floor rather than
 * a misleading number from one or two comps.
 *
 * @param {Object[]} comparables - candidate listings (any normalizePriceCents
 *   shape); filtered to active + matching speciesId internally.
 * @param {number|string|null} speciesId - restrict to this species; pass
 *   null/undefined to skip the species filter (caller already scoped it).
 * @param {Object} [opts]
 * @param {number} [opts.sampleFloor=3] - minimum comparable count required.
 * @returns {{ suggestedCents:number, low:number, high:number, basis:string }|null}
 */
export function buildPriceSuggestion(comparables = [], speciesId, opts = {}) {
  const sampleFloor = Number.isFinite(opts.sampleFloor) ? opts.sampleFloor : DEFAULT_PRICE_SAMPLE_FLOOR;

  const matches = (comparables || []).filter((item) => {
    if (!item || typeof item !== "object") return false;
    if (!isListingActive(item)) return false;
    if (speciesId != null && Number(item.speciesId) !== Number(speciesId)) return false;
    return true;
  });

  const cents = matches
    .map((item) => normalizePriceCents(item))
    .filter((c) => Number.isFinite(c) && c > 0)
    .sort((a, b) => a - b);

  if (cents.length < sampleFloor) return null;

  return {
    suggestedCents: median(cents),
    low: cents[0],
    high: cents[cents.length - 1],
    basis: `Based on ${cents.length} similar active listing${cents.length === 1 ? "" : "s"}.`,
  };
}

function median(sortedAscending) {
  const n = sortedAscending.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0
    ? Math.round((sortedAscending[mid - 1] + sortedAscending[mid]) / 2)
    : sortedAscending[mid];
}
