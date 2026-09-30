/**
 * normalizeSpeciesRecord.js
 *
 * The single enrichment step shared by hooks/useSpeciesData.js and
 * hooks/useCatalogHydration.js before catalog records are cached in Dexie.
 * Pure, so it can be tested without React Query, fetch or IndexedDB.
 *
 * Diet is never backfilled: a record with no recorded diet gets
 * `diet: { trophicLevel: null, fooditems: null, feedingPlaybook: null }`.
 * See services/speciesDiet.js.
 *
 * The non-diet fallbacks below are unchanged from the original hook code.
 */

import { normalizeDiet } from "./speciesDiet.js";

/**
 * @param {Object} item - a fishbase_master.json record (or curator-authored profile)
 * @returns {Object} the enriched record
 */
export function normalizeSpeciesRecord(item = {}) {
  return {
    ...item,
    family: item.family || "Information arriving soon",
    ecology: {
      comments: item.ecology?.comments || "Information arriving soon",
      biotope: item.ecology?.biotope || "Generic Biotope Details",
      phMin: item.ecology?.phMin ?? item.tankMetrics?.phRange?.[0] ?? 6.5,
      phMax: item.ecology?.phMax ?? item.tankMetrics?.phRange?.[1] ?? 7.5,
      hardnessRange: item.ecology?.hardnessRange || "5 - 15 dGH",
      tempCeiling: item.ecology?.tempCeiling ?? item.tankMetrics?.tempRangeCelsius?.[1] ?? 28,
      socialBehavior: item.ecology?.socialBehavior || "Information arriving soon",
    },
    diet: normalizeDiet(item.diet),
    reproduction: {
      spawningTrait: item.reproduction?.spawningTrait || "Information arriving soon",
      layoutRequirement: item.reproduction?.layoutRequirement || "Information arriving soon",
      comments: item.reproduction?.comments || "Information arriving soon",
    },
  };
}
