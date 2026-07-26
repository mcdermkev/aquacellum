/**
 * speciesFit.js — the single "does this species fit this tank?" contract for
 * Fish Finder (Fish Finder Rework, Task 2 / Tier A).
 *
 * Before this, `BreedGallery`'s "Simulate My Tank" widget carried its OWN copy
 * of the multiplicative volume/pH/temperature scoring formula — the same
 * formula that already lived (and was consolidated) in `evaluateTankFit`
 * (addOnRecommender.js) for the Marketplace and Logbook. Three copies of a
 * fit score is three chances to disagree about whether a fish is safe for a
 * tank. This module deletes Fish Finder's copy and makes it compose the
 * canonical engines instead:
 *
 *   speciesProfileForFit → a normalizeSpeciesProfile-shaped profile
 *   assessSpeciesFit     → buildCompatibilityExplanation(profile, tank)
 *                          (which itself wraps evaluateTankFit — the one scorer)
 *
 * It also re-exports `assessStocking` so Fish Finder has a single import
 * surface for compatibility + stocking.
 *
 * Correctness note (the deliberate T2 behavior change): fit is now scored on
 * HONEST ranges. The old widget scored unknown-range species against fabricated
 * 22–28°C / pH 6.5–7.5 defaults, which could invent a confident score for a
 * species we have no data on. The canonical engine instead treats unknown data
 * as "caution, never blocked" (see evaluateTankFit's design note), so Fish
 * Finder now matches the Marketplace/Logbook verdict for every species. Species
 * with complete curated data score exactly as before.
 *
 * Pure and dependency-light: composes existing Tier-A/B services only.
 */

import { buildCompatibilityExplanation } from "./compatibilityExplanation.js";
import { normalizeSpeciesProfile } from "./shippingSafety.js";
import { assessStocking, stockingHeadline } from "../utils/stockingGuidance.js";

// Re-export so callers get compatibility + stocking from one module.
export { assessStocking, stockingHeadline };

function isNum(v) {
  // Note: Number(null) === 0 (finite), so null/undefined must be rejected first.
  return v != null && v !== "" && Number.isFinite(Number(v));
}

/**
 * Resolve a catalog entry (either the T1 global shape, which carries an honest
 * `.profile`, or an on-chain contract entry with flat minTemp/maxTemp/minPh/
 * maxPh) into the profile shape the scorer consumes.
 *
 * The entry's OWN ranges are always preferred (they are the authoritative
 * temp/pH for that entry — curated for globals, on-chain for contract species).
 * The master catalog is used ONLY to fill fields the entry lacks — minimum tank
 * volume and adult size — matched on scientific name, exactly as the old widget
 * did via its `masterLookup`. Nothing is fabricated: an unknown range stays
 * null so the scorer degrades to "caution".
 *
 * @param {Object} entry - catalog entry (global or contract shape)
 * @param {Object} [opts]
 * @param {Array}  [opts.fishbaseData] - curated master records (for volume/size fill)
 * @returns {Object|null} normalizeSpeciesProfile-shaped profile
 */
export function speciesProfileForFit(entry, { fishbaseData = [] } = {}) {
  if (!entry) return null;

  // Honest base profile: globals already have one (T1); otherwise normalize the
  // entry's own fields (on-chain ranges become tempRange/phRange fallbacks).
  const base = entry.profile || normalizeSpeciesProfile(entry);

  // Fill only the fields the entry can't supply, from the master catalog.
  const master = fishbaseData.find(
    (f) => f && f.scientificName &&
      f.scientificName.toLowerCase() === String(entry.scientificName || "").toLowerCase()
  );

  const minVolumeGallons = isNum(base.minVolumeGallons)
    ? Number(base.minVolumeGallons)
    : (isNum(master?.tankMetrics?.minVolumeGallons) ? Number(master.tankMetrics.minVolumeGallons) : null);

  const adultSizeCm = isNum(base.adultSizeCm)
    ? Number(base.adultSizeCm)
    : (isNum(master?.maxLengthCm) ? Number(master.maxLengthCm) : null);

  return { ...base, minVolumeGallons, adultSizeCm };
}

/**
 * The single fit assessment for a species/tank pair. Composes the canonical
 * scorer + explanation; never re-derives a score or threshold.
 *
 * @param {Object} entry - catalog entry (global or contract shape)
 * @param {{volume:number, temp:number, ph:number}|null|undefined} tankContext
 * @param {Object} [opts]
 * @param {Array}  [opts.fishbaseData]
 * @returns {{
 *   verdict:('ok'|'caution'|'blocked'|'no_tank'), score:number, headline:string,
 *   reasons:string[], profile:(Object|null), minVolumeGallons:(number|null)
 * }}
 */
export function assessSpeciesFit(entry, tankContext, opts = {}) {
  const profile = speciesProfileForFit(entry, opts);
  const explanation = buildCompatibilityExplanation(profile, tankContext);
  return {
    ...explanation,
    profile,
    minVolumeGallons: isNum(profile?.minVolumeGallons) ? Number(profile.minVolumeGallons) : null,
  };
}

function isRange(r) {
  return Array.isArray(r) && r.length === 2 && Number.isFinite(Number(r[0])) && Number.isFinite(Number(r[1]));
}

/**
 * Collapse a fit result into a single presentation kind, distinguishing a
 * missing-data caution (informational — "we don't know yet") from a real
 * mismatch caution (a warning — "this is borderline"). Fish Finder Rework
 * Task 6 / Decision D1: unknown data must never read as a warning.
 *
 * Derived from `fit.verdict` + `fit.profile` completeness — NEVER from
 * `fit.reasons` string content. This exactly mirrors `evaluateTankFit`
 * (addOnRecommender.js), which caps at "caution" precisely when one of
 * minVolumeGallons/tempRange/phRange is unknown: a caution with any of those
 * three missing on the profile is a data gap; a caution with all three known
 * is a real (if borderline) mismatch.
 *
 * @param {{verdict?:string, profile?:Object}|null|undefined} fit - assessSpeciesFit output
 * @returns {'ok'|'caution_data'|'caution_mismatch'|'blocked'|'no_tank'}
 */
export function fitPresentationKind(fit) {
  if (!fit) return "no_tank";

  switch (fit.verdict) {
    case "no_tank":
      return "no_tank";
    case "ok":
      return "ok";
    case "blocked":
      return "blocked";
    case "caution": {
      const profile = fit.profile || {};
      const knownVolume = isNum(profile.minVolumeGallons);
      const knownTemp = isRange(profile.tempRange);
      const knownPh = isRange(profile.phRange);
      return knownVolume && knownTemp && knownPh ? "caution_mismatch" : "caution_data";
    }
    default:
      return "no_tank";
  }
}
