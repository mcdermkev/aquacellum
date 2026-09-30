/**
 * normalizeSpeciesRecord.js
 *
 * The single enrichment step shared by hooks/useSpeciesData.js and
 * hooks/useCatalogHydration.js before catalog records are cached in Dexie.
 * Pure, so it can be tested without React Query, fetch or IndexedDB.
 *
 * Nothing is backfilled. A field the record does not carry comes out null:
 *   - diet: services/speciesDiet.js
 *   - family, ecology.*, reproduction.*: services/speciesCare.js
 * The only derivations are from the record's own real data (ecology.phMin /
 * phMax / tempCeiling fall back to tankMetrics.phRange / tempRangeCelsius).
 */

import { normalizeDiet } from "./speciesDiet.js";
import { realCareText, normalizeEcology, normalizeReproduction } from "./speciesCare.js";

/**
 * @param {Object} item - a fishbase_master.json record (or curator-authored profile)
 * @returns {Object} the enriched record
 */
export function normalizeSpeciesRecord(item = {}) {
  return {
    ...item,
    family: realCareText(item.family),
    ecology: normalizeEcology(item.ecology, item.tankMetrics),
    diet: normalizeDiet(item.diet),
    reproduction: normalizeReproduction(item.reproduction),
  };
}
