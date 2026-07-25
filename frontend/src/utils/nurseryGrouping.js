/**
 * nurseryGrouping.js — pure grouping for the Specimen Nursery (Logbook Rework Task 7).
 *
 * Extracted from the FryNursery component so it can be unit-tested without pulling
 * in the relayer / ethers (which need a browser `window`).
 */

/** Group unassigned specimens by species with counts + gender breakdown. */
export function groupNurseryFish(fish) {
  const map = new Map();
  for (const f of Array.isArray(fish) ? fish : []) {
    const key = String(f.speciesId ?? f.commonName ?? "unknown");
    if (!map.has(key)) {
      map.set(key, {
        key,
        speciesId: f.speciesId,
        commonName: f.commonName || f.scientificName || "Unknown",
        scientificName: f.scientificName || "",
        fish: [],
        genders: { Male: 0, Female: 0, Unsexed: 0 },
      });
    }
    const g = map.get(key);
    g.fish.push(f);
    const gender = f.gender === "Male" ? "Male" : f.gender === "Female" ? "Female" : "Unsexed";
    g.genders[gender] += 1;
  }
  return [...map.values()]
    .map((g) => ({ ...g, count: g.fish.length }))
    .sort((a, b) => b.count - a.count);
}
