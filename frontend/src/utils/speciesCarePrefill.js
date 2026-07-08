/**
 * speciesCarePrefill.js
 *
 * Pulls species-level care data from the bundled fishbase reference so listing
 * forms can pre-fill the "helps buyers decide" fields (temperature, pH, minimum
 * tank size, care level). The seller then only has to set price + fulfillment
 * method — the fish already knows what it is.
 *
 * The reference stores temperature in Celsius; the listing forms use °F, so we
 * convert. pH range and minimum gallons are used as-is. All values are suggested
 * and remain fully editable by the seller.
 */

let _lookup = null;
let _loadingPromise = null;

const DIFFICULTY_TO_CARE_LEVEL = {
  beginner: 0,
  easy: 0,
  intermediate: 1,
  moderate: 1,
  advanced: 2,
  expert: 2,
  hard: 2,
};

function celsiusToFahrenheit(c) {
  if (c == null || Number.isNaN(Number(c))) return null;
  return Math.round((Number(c) * 9) / 5 + 32);
}

/**
 * Load (and cache) the scientificName → tankMetrics lookup from the bundled
 * fishbase reference. Safe to call repeatedly; the fetch happens once. Returns
 * an empty Map if the reference can't be loaded (prefill just no-ops).
 */
export async function loadSpeciesCareLookup() {
  if (_lookup) return _lookup;
  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = (async () => {
    try {
      const res = await fetch("/fishbase_master.json");
      if (!res.ok) throw new Error(`fishbase_master.json ${res.status}`);
      const data = await res.json();
      const map = new Map();
      for (const entry of data) {
        if (entry?.scientificName) {
          map.set(entry.scientificName.toLowerCase(), entry.tankMetrics || {});
        }
      }
      _lookup = map;
      return _lookup;
    } catch (err) {
      console.warn("[speciesCarePrefill] Could not load care reference:", err.message);
      _lookup = new Map();
      return _lookup;
    }
  })();

  return _loadingPromise;
}

/**
 * Derive listing care fields (in the units the forms expect) for a species.
 * Returns null when no reference data exists for the scientific name.
 *
 * @param {string} scientificName
 * @param {Map} lookup - from loadSpeciesCareLookup()
 * @returns {null | {careLevel:number, minTemp:string, maxTemp:string, minPh:string, maxPh:string, tankSizeMin:string}}
 */
export function deriveCareFields(scientificName, lookup) {
  if (!scientificName || !lookup) return null;
  const tm = lookup.get(scientificName.toLowerCase());
  if (!tm) return null;

  const out = {};

  if (Array.isArray(tm.tempRangeCelsius) && tm.tempRangeCelsius.length === 2) {
    const minF = celsiusToFahrenheit(tm.tempRangeCelsius[0]);
    const maxF = celsiusToFahrenheit(tm.tempRangeCelsius[1]);
    if (minF != null) out.minTemp = String(minF);
    if (maxF != null) out.maxTemp = String(maxF);
  }

  if (Array.isArray(tm.phRange) && tm.phRange.length === 2) {
    if (tm.phRange[0] != null) out.minPh = String(tm.phRange[0]);
    if (tm.phRange[1] != null) out.maxPh = String(tm.phRange[1]);
  }

  if (tm.minVolumeGallons != null) {
    out.tankSizeMin = String(tm.minVolumeGallons);
  }

  if (tm.difficulty) {
    const lvl = DIFFICULTY_TO_CARE_LEVEL[String(tm.difficulty).toLowerCase()];
    if (lvl != null) out.careLevel = lvl;
  }

  return Object.keys(out).length > 0 ? out : null;
}
