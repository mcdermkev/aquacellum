/**
 * speciesRecordLookup.js
 *
 * Loads (and caches) the bundled fishbase reference, keyed by scientific
 * name, and returns the FULL record — unlike `speciesCarePrefill.js`'s
 * `loadSpeciesCareLookup` (which only extracts `tankMetrics`), this is the
 * complete record `listingDraft.js`'s `buildListingDraftFromSpecies` needs
 * (ecology/diet/behavior/tankMetrics/maxLengthCm), since that module
 * composes `normalizeSpeciesProfile` which reads from all of those.
 *
 * Same fetch-once-cache-forever pattern as `speciesCarePrefill.js`; kept as
 * a separate module rather than widening that one's narrower contract.
 */

let _lookup = null;
let _loadingPromise = null;

/**
 * Load (and cache) the scientificName → full record lookup from the bundled
 * fishbase reference. Safe to call repeatedly; the fetch happens once.
 * Returns an empty Map if the reference can't be loaded.
 * @returns {Promise<Map<string, Object>>}
 */
export async function loadSpeciesRecordLookup() {
  if (_lookup) return _lookup;
  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = (async () => {
    try {
      const res = await fetch("/fishbase_master.json?v=2");
      if (!res.ok) throw new Error(`fishbase_master.json ${res.status}`);
      const data = await res.json();
      const map = new Map();
      for (const entry of data) {
        if (entry?.scientificName) {
          map.set(entry.scientificName.toLowerCase(), entry);
        }
      }
      _lookup = map;
      return _lookup;
    } catch (err) {
      console.warn("[speciesRecordLookup] Could not load species reference:", err.message);
      _lookup = new Map();
      return _lookup;
    }
  })();

  return _loadingPromise;
}

/**
 * Look up a species' full reference record by scientific name.
 * @param {string} scientificName
 * @param {Map} lookup - from loadSpeciesRecordLookup()
 * @returns {Object|null}
 */
export function getSpeciesRecord(scientificName, lookup) {
  if (!scientificName || !lookup) return null;
  return lookup.get(scientificName.toLowerCase()) || null;
}
