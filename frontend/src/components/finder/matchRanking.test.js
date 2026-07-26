import { describe, it, expect } from "vitest";
import { rankSpeciesMatches } from "./matchRanking.js";
import { assessSpeciesFit } from "../../services/speciesFit.js";
import { toCatalogEntry } from "../../services/speciesCatalog.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────
// Fully-specified curated records → their T1 global catalog entries.

const NEON_RECORD = {
  specCode: 100,
  scientificName: "Paracheirodon innesi",
  commonName: "Neon Tetra",
  maxLengthCm: 3.5,
  tankMetrics: { tempRangeCelsius: [20, 26], phRange: [6, 7], difficulty: "Beginner", minVolumeGallons: 10 },
};
const NEON_ENTRY = toCatalogEntry(NEON_RECORD);

// A "good but not perfect" fit: pH slightly outside range at the given tank.
const GUPPY_RECORD = {
  specCode: 101,
  scientificName: "Poecilia reticulata",
  commonName: "Guppy",
  maxLengthCm: 5,
  tankMetrics: { tempRangeCelsius: [22, 28], phRange: [7, 8], difficulty: "Beginner", minVolumeGallons: 10 },
};
const GUPPY_ENTRY = toCatalogEntry(GUPPY_RECORD);

// A species that will be blocked for a small tank (needs 55 gal).
const OSCAR_RECORD = {
  specCode: 102,
  scientificName: "Astronotus ocellatus",
  commonName: "Oscar",
  maxLengthCm: 30,
  tankMetrics: { tempRangeCelsius: [22, 27], phRange: [6, 7.5], difficulty: "Intermediate", minVolumeGallons: 55 },
};
const OSCAR_ENTRY = toCatalogEntry(OSCAR_RECORD);

// A sparse species with no curated ranges — degrades to caution (never fabricated).
const SPARSE_ENTRY = toCatalogEntry({
  specCode: 103,
  scientificName: "Mysteryus incognitus",
  commonName: "Mystery Fish",
});

// Second beginner-friendly species with an identical fit profile to Neon, to
// exercise the name tiebreak deterministically ("Betta" < "Neon Tetra").
const BETTA_RECORD = {
  specCode: 104,
  scientificName: "Betta splendens",
  commonName: "Betta",
  maxLengthCm: 6,
  tankMetrics: { tempRangeCelsius: [20, 26], phRange: [6, 7], difficulty: "Beginner", minVolumeGallons: 10 },
};
const BETTA_ENTRY = toCatalogEntry(BETTA_RECORD);

const ALL_RECORDS = [NEON_RECORD, GUPPY_RECORD, OSCAR_RECORD, BETTA_RECORD];
const ALL_ENTRIES = [NEON_ENTRY, GUPPY_ENTRY, OSCAR_ENTRY, BETTA_ENTRY, SPARSE_ENTRY];

const GOOD_TANK = { volume: 20, temp: 23, ph: 6.5 };

describe("rankSpeciesMatches — null tank", () => {
  it("returns [] when tankContext is null", () => {
    expect(rankSpeciesMatches(ALL_ENTRIES, null, { fishbaseData: ALL_RECORDS })).toEqual([]);
  });

  it("returns [] when tankContext is undefined", () => {
    expect(rankSpeciesMatches(ALL_ENTRIES, undefined, { fishbaseData: ALL_RECORDS })).toEqual([]);
  });

  it("returns [] for an empty/missing entries array", () => {
    expect(rankSpeciesMatches([], GOOD_TANK)).toEqual([]);
    expect(rankSpeciesMatches(null, GOOD_TANK)).toEqual([]);
  });
});

describe("rankSpeciesMatches — deterministic sort", () => {
  it("orders ok before caution before blocked", () => {
    const results = rankSpeciesMatches(ALL_ENTRIES, GOOD_TANK, { fishbaseData: ALL_RECORDS });
    const verdicts = results.map((r) => r.fit.verdict);

    // Oscar (needs 55gal, tank is 20gal) should rank after any ok/caution entries.
    const oscarIndex = results.findIndex((r) => r.entry.speciesId === OSCAR_ENTRY.speciesId);
    const okIndexes = results
      .map((r, i) => (r.fit.verdict === "ok" ? i : -1))
      .filter((i) => i !== -1);
    for (const okIdx of okIndexes) {
      expect(okIdx).toBeLessThan(oscarIndex);
    }

    // Verdict ranks should be non-decreasing across the sorted list.
    const RANK = { ok: 0, caution: 1, blocked: 2, no_tank: 3 };
    for (let i = 1; i < verdicts.length; i++) {
      expect(RANK[verdicts[i]]).toBeGreaterThanOrEqual(RANK[verdicts[i - 1]]);
    }
  });

  it("within the same verdict, sorts by score descending", () => {
    const results = rankSpeciesMatches(ALL_ENTRIES, GOOD_TANK, { fishbaseData: ALL_RECORDS });
    for (let i = 1; i < results.length; i++) {
      const prevRank = VERDICT_RANK(results[i - 1].fit.verdict);
      const curRank = VERDICT_RANK(results[i].fit.verdict);
      if (prevRank === curRank) {
        expect(results[i - 1].fit.score).toBeGreaterThanOrEqual(results[i].fit.score);
      }
    }
  });

  it("breaks ties by commonName ascending when verdict and score match", () => {
    // Neon and Betta share an identical profile shape at this tank → same
    // verdict/score. "Betta" must sort before "Neon Tetra".
    const results = rankSpeciesMatches([NEON_ENTRY, BETTA_ENTRY], GOOD_TANK, {
      fishbaseData: [NEON_RECORD, BETTA_RECORD],
    });
    expect(results[0].fit.verdict).toBe(results[1].fit.verdict);
    expect(results[0].fit.score).toBe(results[1].fit.score);
    expect(results[0].entry.commonName).toBe("Betta");
    expect(results[1].entry.commonName).toBe("Neon Tetra");
  });

  function VERDICT_RANK(v) {
    return { ok: 0, caution: 1, blocked: 2, no_tank: 3 }[v] ?? 1;
  }
});

describe("rankSpeciesMatches — excludeSpeciesIds", () => {
  it("removes excluded species (e.g. species already in the tank)", () => {
    const results = rankSpeciesMatches(ALL_ENTRIES, GOOD_TANK, {
      fishbaseData: ALL_RECORDS,
      excludeSpeciesIds: [NEON_ENTRY.speciesId, BETTA_ENTRY.speciesId],
    });
    const ids = results.map((r) => r.entry.speciesId);
    expect(ids).not.toContain(NEON_ENTRY.speciesId);
    expect(ids).not.toContain(BETTA_ENTRY.speciesId);
  });

  it("defaults to excluding nothing when omitted", () => {
    const results = rankSpeciesMatches(ALL_ENTRIES, GOOD_TANK, { fishbaseData: ALL_RECORDS });
    const ids = results.map((r) => r.entry.speciesId);
    expect(ids).toContain(NEON_ENTRY.speciesId);
  });
});

describe("rankSpeciesMatches — limit", () => {
  it("caps results at the given limit", () => {
    const results = rankSpeciesMatches(ALL_ENTRIES, GOOD_TANK, { fishbaseData: ALL_RECORDS, limit: 2 });
    expect(results.length).toBe(2);
  });

  it("defaults to a limit of 12", () => {
    // Fewer than 12 candidates exist here, so this just proves no artificial
    // truncation happens below the full candidate count.
    const results = rankSpeciesMatches(ALL_ENTRIES, GOOD_TANK, { fishbaseData: ALL_RECORDS });
    expect(results.length).toBe(ALL_ENTRIES.length);
  });
});

describe("rankSpeciesMatches — composition, not a fork", () => {
  it("produces verdicts/scores equal to assessSpeciesFit for the same inputs", () => {
    const results = rankSpeciesMatches(ALL_ENTRIES, GOOD_TANK, { fishbaseData: ALL_RECORDS });
    for (const { entry, fit } of results) {
      const direct = assessSpeciesFit(entry, GOOD_TANK, { fishbaseData: ALL_RECORDS });
      expect(fit).toEqual(direct);
    }
  });

  it("never fabricates a verdict for a sparse/unknown-data species (honest caution)", () => {
    const results = rankSpeciesMatches([SPARSE_ENTRY], GOOD_TANK, { fishbaseData: [] });
    expect(results[0].fit.verdict).toBe("caution");
  });
});
