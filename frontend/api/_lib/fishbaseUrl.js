/**
 * FishBase summary URL for a catalog record (fishbase_master.json shape).
 *
 * `specCode` is the Aquacellum catalog ID. It is NOT always a FishBase SpecCode
 * (many freshwater records were numbered by hand), so it is never used to build
 * a FishBase link. The real code is `fishbaseSpecCode`, written by
 * scripts/fix-fishbase-codes.mjs from the local FishBase dump.
 *
 *   - fishbaseSpecCode present      -> https://www.fishbase.se/summary/<code>
 *   - plant / invertebrate / coral / amphibian, WoRMS record, or a
 *     non-FishBase ID band          -> null (FishBase has no page for it)
 *   - otherwise (fish, code unknown) -> summary page by scientific name
 */

// Hand-assigned freshwater inverts, plants, Supabase-added species, and
// WoRMS corals / marine inverts.
const NON_FISHBASE_TYPES = new Set(["plant", "invertebrate", "coral", "amphibian"]);
const NON_FISHBASE_BANDS = [[80001, 80999], [90001, 90999], [100000, 199999], [200001, Infinity]];

export function fishbaseUrl(sp) {
  const code = Number(sp?.fishbaseSpecCode);
  if (Number.isInteger(code) && code > 0) return `https://www.fishbase.se/summary/${code}`;
  if (NON_FISHBASE_TYPES.has(String(sp?.type || "").toLowerCase())) return null;
  if (Number(sp?.marine?.aphiaId) > 0) return null;
  const id = Number(sp?.specCode);
  if (NON_FISHBASE_BANDS.some(([lo, hi]) => id >= lo && id <= hi)) return null;
  const binomial = String(sp?.scientificName || "").trim().split(/\s+/).slice(0, 2);
  if (binomial.length !== 2 || !/^[A-Z]/.test(binomial[0])) return null;
  return `https://www.fishbase.se/summary/${binomial.map(encodeURIComponent).join("-")}.html`;
}
