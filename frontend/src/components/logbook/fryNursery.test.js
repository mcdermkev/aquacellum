import { describe, it, expect } from "vitest";
import { groupNurseryFish } from "../../utils/nurseryGrouping";

describe("FryNursery — groupNurseryFish", () => {
  it("groups by species with counts, sorted by count desc", () => {
    const fish = [
      { id: 1, speciesId: 10, commonName: "Common Goldfish", gender: "Male" },
      { id: 2, speciesId: 10, commonName: "Common Goldfish", gender: "Female" },
      { id: 3, speciesId: 10, commonName: "Common Goldfish", gender: "Unsexed" },
      { id: 4, speciesId: 20, commonName: "Blue Acara", gender: "Male" },
    ];
    const groups = groupNurseryFish(fish);
    expect(groups).toHaveLength(2);
    expect(groups[0].commonName).toBe("Common Goldfish");
    expect(groups[0].count).toBe(3);
    expect(groups[0].genders).toEqual({ Male: 1, Female: 1, Unsexed: 1 });
    expect(groups[1].commonName).toBe("Blue Acara");
    expect(groups[1].count).toBe(1);
  });

  it("treats 'Not Sure' and missing gender as Unsexed", () => {
    const groups = groupNurseryFish([
      { id: 1, speciesId: 5, commonName: "Tetra", gender: "Not Sure" },
      { id: 2, speciesId: 5, commonName: "Tetra" },
    ]);
    expect(groups[0].genders.Unsexed).toBe(2);
  });

  it("falls back to commonName when speciesId is absent", () => {
    const groups = groupNurseryFish([
      { id: 1, commonName: "Mystery Snail" },
      { id: 2, commonName: "Mystery Snail" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it("returns empty for no fish", () => {
    expect(groupNurseryFish([])).toEqual([]);
    expect(groupNurseryFish(null)).toEqual([]);
  });
});
