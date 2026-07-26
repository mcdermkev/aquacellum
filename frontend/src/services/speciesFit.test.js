import { describe, it, expect } from "vitest";
import { speciesProfileForFit, assessSpeciesFit, fitPresentationKind } from "./speciesFit.js";
import { buildCompatibilityExplanation } from "./compatibilityExplanation.js";
import { evaluateTankFit } from "./addOnRecommender.js";
import { toCatalogEntry } from "./speciesCatalog.js";

// ─────────────────────────────────────────────────────────────────────────────
// Legacy reference: BreedGallery's bespoke compatibility useMemo, verbatim.
// Scores a `selectedBreed` (with minTemp/maxTemp/minPh/maxPh) against a sim
// tank, using masterLookup minVolume (?? 30). The tests below prove the new
// composed contract reproduces this EXACTLY for species with complete data.
// ─────────────────────────────────────────────────────────────────────────────
function legacyCompatibilityScore(selectedBreed, masterMinVol, simVolume, simPh, simTemp) {
  const minVol = masterMinVol ?? 30;
  let pVol = 0;
  if (simVolume < minVol) pVol = ((minVol - simVolume) / minVol) * 100;
  let pPh = 0;
  if (simPh < selectedBreed.minPh) pPh = ((selectedBreed.minPh - simPh) / 1.5) * 100;
  else if (simPh > selectedBreed.maxPh) pPh = ((simPh - selectedBreed.maxPh) / 1.5) * 100;
  pPh = Math.min(100, pPh);
  let pTemp = 0;
  if (simTemp < selectedBreed.minTemp) pTemp = ((selectedBreed.minTemp - simTemp) / 5.0) * 100;
  else if (simTemp > selectedBreed.maxTemp) pTemp = ((simTemp - selectedBreed.maxTemp) / 5.0) * 100;
  pTemp = Math.min(100, pTemp);
  const sVol = Math.max(0, 100 - pVol);
  const sPh = Math.max(0, 100 - pPh);
  const sTemp = Math.max(0, 100 - pTemp);
  return Math.round((sVol / 100) * (sPh / 100) * (sTemp / 100) * 100);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Fully-specified curated record → its T1 global catalog entry (has .profile).
const NEON_RECORD = {
  specCode: 100,
  scientificName: "Paracheirodon innesi",
  commonName: "Neon Tetra",
  maxLengthCm: 3.5,
  tankMetrics: { tempRangeCelsius: [20, 26], phRange: [6, 7], difficulty: "Beginner", minVolumeGallons: 10 },
};
const NEON_ENTRY = toCatalogEntry(NEON_RECORD);

// On-chain contract entry shape: flat ranges, NO minVolume / size.
const CONTRACT_ENTRY = {
  speciesId: 3,
  scientificName: "Betta splendens",
  commonName: "Betta",
  careLevel: 1,
  minTemp: 24, maxTemp: 28,
  minPh: 6.5, maxPh: 7.5,
  specimenCount: 2,
};
// Master record that supplies the contract species' volume + size.
const BETTA_MASTER = {
  specCode: 5000,
  scientificName: "Betta splendens",
  commonName: "Betta",
  maxLengthCm: 6.5,
  tankMetrics: { minVolumeGallons: 5 },
};

// A species with no curated ranges at all (sparse) → honest unknowns.
const SPARSE_ENTRY = toCatalogEntry({
  specCode: 999,
  scientificName: "Mysteryus incognitus",
  commonName: "Mystery Fish",
});

describe("speciesProfileForFit", () => {
  it("uses the honest T1 profile for a global entry (no fabricated ranges)", () => {
    const p = speciesProfileForFit(NEON_ENTRY, { fishbaseData: [NEON_RECORD] });
    expect(p.tempRange).toEqual([20, 26]);
    expect(p.phRange).toEqual([6, 7]);
    expect(p.minVolumeGallons).toBe(10);
    expect(p.adultSizeCm).toBe(3.5);
  });

  it("keeps a sparse species' ranges null instead of inventing them", () => {
    const p = speciesProfileForFit(SPARSE_ENTRY, { fishbaseData: [] });
    expect(p.tempRange).toBeNull();
    expect(p.phRange).toBeNull();
    expect(p.minVolumeGallons).toBeNull();
  });

  it("fills volume/size for a contract entry from the master catalog, keeping on-chain ranges", () => {
    const p = speciesProfileForFit(CONTRACT_ENTRY, { fishbaseData: [BETTA_MASTER] });
    expect(p.tempRange).toEqual([24, 28]);   // on-chain ranges preserved
    expect(p.phRange).toEqual([6.5, 7.5]);
    expect(p.minVolumeGallons).toBe(5);       // filled from master
    expect(p.adultSizeCm).toBe(6.5);          // filled from master
  });

  it("leaves contract volume/size null when the species isn't in the master catalog", () => {
    const p = speciesProfileForFit(CONTRACT_ENTRY, { fishbaseData: [] });
    expect(p.minVolumeGallons).toBeNull();
    expect(p.adultSizeCm).toBeNull();
  });
});

describe("assessSpeciesFit — composition, not a fork", () => {
  const tank = { volume: 20, temp: 23, ph: 6.5 };

  it("returns exactly what buildCompatibilityExplanation/evaluateTankFit produce for the profile", () => {
    const profile = speciesProfileForFit(NEON_ENTRY, { fishbaseData: [NEON_RECORD] });
    const fit = assessSpeciesFit(NEON_ENTRY, tank, { fishbaseData: [NEON_RECORD] });
    const direct = buildCompatibilityExplanation(profile, tank);
    const scorer = evaluateTankFit(profile, tank);
    expect(fit.verdict).toBe(direct.verdict);
    expect(fit.score).toBe(direct.score);
    expect(fit.headline).toBe(direct.headline);
    expect(fit.reasons).toEqual(direct.reasons);
    // and the score is the one scorer's score
    expect(fit.score).toBe(scorer.score);
  });

  it("passes through no_tank when there is no tank context", () => {
    const fit = assessSpeciesFit(NEON_ENTRY, null, { fishbaseData: [NEON_RECORD] });
    expect(fit.verdict).toBe("no_tank");
  });
});

describe("parity with the legacy bespoke widget score (data-complete species)", () => {
  const simPoints = [
    { volume: 10, ph: 6.5, temp: 23 }, // ideal
    { volume: 5, ph: 6.5, temp: 23 },  // undersized
    { volume: 40, ph: 8.2, temp: 23 }, // pH high
    { volume: 40, ph: 6.5, temp: 30 }, // temp high
    { volume: 3, ph: 5.0, temp: 32 },  // multiple off
  ];

  it("matches the old formula exactly for a fully-specified species", () => {
    for (const t of simPoints) {
      const fit = assessSpeciesFit(NEON_ENTRY, t, { fishbaseData: [NEON_RECORD] });
      const legacy = legacyCompatibilityScore(
        { minPh: 6, maxPh: 7, minTemp: 20, maxTemp: 26 }, 10, t.volume, t.ph, t.temp
      );
      expect(fit.score).toBe(legacy);
    }
  });

  it("matches the old formula for a contract species (volume filled from master)", () => {
    for (const t of simPoints) {
      const fit = assessSpeciesFit(CONTRACT_ENTRY, t, { fishbaseData: [BETTA_MASTER] });
      const legacy = legacyCompatibilityScore(
        { minPh: 6.5, maxPh: 7.5, minTemp: 24, maxTemp: 28 }, 5, t.volume, t.ph, t.temp
      );
      expect(fit.score).toBe(legacy);
    }
  });
});

describe("honest handling of unknown-data species (the intended T2 fix)", () => {
  it("never blocks and flags caution when ranges are unknown, instead of a fabricated score", () => {
    // Perfect-looking tank; but the species has no known ranges.
    const fit = assessSpeciesFit(SPARSE_ENTRY, { volume: 100, temp: 25, ph: 7 }, { fishbaseData: [] });
    expect(fit.verdict).toBe("caution");
    expect(fit.reasons.join(" ")).toMatch(/don't have|unknown|confirmed/i);
  });
});

describe("fitPresentationKind — the honest-caution classifier (T6, Decision D1)", () => {
  it("returns 'no_tank' for a falsy fit", () => {
    expect(fitPresentationKind(null)).toBe("no_tank");
    expect(fitPresentationKind(undefined)).toBe("no_tank");
  });

  it("passes through 'no_tank' when there is no tank context", () => {
    const fit = assessSpeciesFit(NEON_ENTRY, null, { fishbaseData: [NEON_RECORD] });
    expect(fit.verdict).toBe("no_tank");
    expect(fitPresentationKind(fit)).toBe("no_tank");
  });

  it("passes through 'ok'", () => {
    const fit = assessSpeciesFit(NEON_ENTRY, { volume: 20, temp: 23, ph: 6.5 }, { fishbaseData: [NEON_RECORD] });
    expect(fit.verdict).toBe("ok");
    expect(fitPresentationKind(fit)).toBe("ok");
  });

  it("passes through 'blocked'", () => {
    // Tank is less than half the Neon's 10-gallon minimum → blocked.
    const fit = assessSpeciesFit(NEON_ENTRY, { volume: 2, temp: 23, ph: 6.5 }, { fishbaseData: [NEON_RECORD] });
    expect(fit.verdict).toBe("blocked");
    expect(fitPresentationKind(fit)).toBe("blocked");
  });

  it("classifies a caution with all three of volume/temp/pH known as 'caution_mismatch'", () => {
    // Borderline (not blocked, score < 80): pH just outside range.
    const fit = assessSpeciesFit(NEON_ENTRY, { volume: 20, temp: 23, ph: 7.8 }, { fishbaseData: [NEON_RECORD] });
    expect(fit.verdict).toBe("caution");
    expect(fit.profile.minVolumeGallons).not.toBeNull();
    expect(fit.profile.tempRange).not.toBeNull();
    expect(fit.profile.phRange).not.toBeNull();
    expect(fitPresentationKind(fit)).toBe("caution_mismatch");
  });

  it("classifies a caution with an unknown minVolumeGallons as 'caution_data'", () => {
    const fit = assessSpeciesFit(SPARSE_ENTRY, { volume: 100, temp: 25, ph: 7 }, { fishbaseData: [] });
    expect(fit.verdict).toBe("caution");
    expect(fit.profile.minVolumeGallons).toBeNull();
    expect(fitPresentationKind(fit)).toBe("caution_data");
  });

  it("classifies a caution with an unknown tempRange as 'caution_data'", () => {
    const entry = toCatalogEntry({
      specCode: 200,
      scientificName: "Partialus rangeus",
      commonName: "Partial Data Fish",
      tankMetrics: { phRange: [6, 7], difficulty: "Beginner", minVolumeGallons: 10 },
      // no tempRangeCelsius
    });
    const fit = assessSpeciesFit(entry, { volume: 100, temp: 25, ph: 6.5 }, { fishbaseData: [] });
    expect(fit.verdict).toBe("caution");
    expect(fit.profile.tempRange).toBeNull();
    expect(fitPresentationKind(fit)).toBe("caution_data");
  });

  it("classifies a caution with an unknown phRange as 'caution_data'", () => {
    const entry = toCatalogEntry({
      specCode: 201,
      scientificName: "Partialus phus",
      commonName: "Partial pH Fish",
      tankMetrics: { tempRangeCelsius: [20, 26], difficulty: "Beginner", minVolumeGallons: 10 },
      // no phRange
    });
    const fit = assessSpeciesFit(entry, { volume: 100, temp: 23, ph: 7 }, { fishbaseData: [] });
    expect(fit.verdict).toBe("caution");
    expect(fit.profile.phRange).toBeNull();
    expect(fitPresentationKind(fit)).toBe("caution_data");
  });

  it("never fabricates a warning for unknown data even against a perfect-looking tank", () => {
    // Guards the exact D1 scenario the spec calls out: a "perfect water"
    // tank should still show the neutral/informational kind, not a mismatch.
    const fit = assessSpeciesFit(SPARSE_ENTRY, { volume: 1000, temp: 24, ph: 7 }, { fishbaseData: [] });
    expect(fitPresentationKind(fit)).toBe("caution_data");
    expect(fitPresentationKind(fit)).not.toBe("caution_mismatch");
  });
});
