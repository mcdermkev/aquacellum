/**
 * Unit tests for the assisted-listing draft core (Task 9 Increment 2, Tier B).
 *
 * Covers docs/TASK_09_INC2_LISTING_FLOW_SPEC.md §4 acceptance criteria 1-4:
 *   1. Auto-populate correctness (dataConfidence, no fabrication on missing data)
 *   2. Grounding whitelist (anti-fabrication guarantee at the data layer)
 *   3. Packing profile matches deriveDefaultPackingProfile exactly
 *   4. Price suggestion: median/range, null below the sample floor
 *
 * Run with: npx vitest --run src/__tests__/listingDraft.test.js
 */

import { describe, it, expect } from "vitest";
import { buildListingDraftFromSpecies, buildPriceSuggestion } from "../services/listingDraft.js";
import { deriveDefaultPackingProfile } from "../services/packingEngine.js";
import { normalizeSpeciesProfile } from "../services/shippingSafety.js";

const neon = {
  commonName: "Neon Tetra",
  scientificName: "Paracheirodon innesi",
  maxLengthCm: 4,
  tankMetrics: { tempRangeCelsius: [22, 26], phRange: [6, 7], minVolumeGallons: 10, difficulty: "easy" },
  diet: { trophicLevel: "Omnivore", fooditems: "Micro-pellets, small live/frozen foods" },
  behavior: { temperament: "Peaceful community fish, best in schools" },
  ecology: { biotope: "Amazon basin blackwater tributaries" },
};

const sparse = {
  commonName: "Mystery Fish",
  scientificName: "Species incognitus",
  // No tankMetrics, no diet, no behavior/ecology at all.
};

describe("buildListingDraftFromSpecies — auto-populate correctness (§4.1)", () => {
  it("maps a well-populated record to the right care values via normalizeSpeciesProfile", () => {
    const draft = buildListingDraftFromSpecies(neon);
    expect(draft.care.minVolumeGallons).toBe(10);
    expect(draft.care.tempRangeCelsius).toEqual([22, 26]);
    expect(draft.care.phRange).toEqual([6, 7]);
    expect(draft.care.adultSizeCm).toBe(4);
    expect(draft.care.temperament).toBe("peaceful");
    expect(draft.care.careLevel).toBe(0);
    expect(draft.care.diet).toBe("Micro-pellets, small live/frozen foods");
  });

  it("carries a dataConfidence map with every field marked known for a well-populated record", () => {
    const draft = buildListingDraftFromSpecies(neon);
    expect(draft.care.dataConfidence).toEqual({
      minVolumeGallons: true,
      tempRangeCelsius: true,
      phRange: true,
      adultSizeCm: true,
      temperament: true,
      careLevel: true,
      diet: true,
    });
  });

  it("degrades missing fields to null/estimated — never fabricated", () => {
    const draft = buildListingDraftFromSpecies(sparse);
    expect(draft.care.minVolumeGallons).toBeNull();
    expect(draft.care.tempRangeCelsius).toBeNull();
    expect(draft.care.phRange).toBeNull();
    expect(draft.care.adultSizeCm).toBeNull();
    expect(draft.care.careLevel).toBeNull();
    expect(draft.care.diet).toBeNull();
    expect(draft.care.temperament).toBe("unknown");
    expect(draft.care.dataConfidence).toEqual({
      minVolumeGallons: false,
      tempRangeCelsius: false,
      phRange: false,
      adultSizeCm: false,
      temperament: false,
      careLevel: false,
      diet: false,
    });
  });

  it("resolves careLevel from an explicit numeric field (on-chain catalog shape) over a text difficulty label", () => {
    const draft = buildListingDraftFromSpecies({ ...neon, careLevel: 2 });
    expect(draft.care.careLevel).toBe(2);
  });

  it("is pure and deterministic — identical inputs produce identical output", () => {
    const a = buildListingDraftFromSpecies(neon, { quantity: 3 });
    const b = buildListingDraftFromSpecies(neon, { quantity: 3 });
    expect(a).toEqual(b);
  });
});

describe("buildListingDraftFromSpecies — grounding whitelist (§4.2, anti-fabrication)", () => {
  it("groundingFacts contains only the sanitized care/name/origin whitelist", () => {
    const draft = buildListingDraftFromSpecies(neon);
    expect(Object.keys(draft.groundingFacts).sort()).toEqual(
      [
        "adultSizeCm",
        "careLevel",
        "commonName",
        "diet",
        "minVolumeGallons",
        "origin",
        "phRange",
        "scientificName",
        "temperament",
        "tempRangeCelsius",
      ].sort()
    );
  });

  it("excludes any health/guarantee/lineage/price field even if present on the source record", () => {
    const withDangerousFields = {
      ...neon,
      healthStatus: "healthy",
      doaGuarantee: true,
      sireId: 12,
      damId: 7,
      priceUsd: "999.99",
      priceCentsUSD: 99999,
      description: "Guaranteed to live forever, beginner-safe, award winning!",
    };
    const draft = buildListingDraftFromSpecies(withDangerousFields);
    const keys = Object.keys(draft.groundingFacts);
    for (const forbidden of [
      "healthStatus",
      "doaGuarantee",
      "sireId",
      "damId",
      "priceUsd",
      "priceCentsUSD",
      "description",
      "guarantee",
      "price",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    // And the whitelist values themselves never echo the dangerous strings.
    expect(JSON.stringify(draft.groundingFacts)).not.toMatch(/guarantee|award|forever/i);
  });

  it("groundingFacts degrades to null for missing facts, never fabricating a value", () => {
    const draft = buildListingDraftFromSpecies(sparse);
    expect(draft.groundingFacts.adultSizeCm).toBeNull();
    expect(draft.groundingFacts.tempRangeCelsius).toBeNull();
    expect(draft.groundingFacts.phRange).toBeNull();
    expect(draft.groundingFacts.careLevel).toBeNull();
    expect(draft.groundingFacts.diet).toBeNull();
    expect(draft.groundingFacts.origin).toBeNull();
    expect(draft.groundingFacts.commonName).toBe("Mystery Fish");
    expect(draft.groundingFacts.scientificName).toBe("Species incognitus");
  });
});

describe("buildListingDraftFromSpecies — packing profile (§4.3)", () => {
  it("matches deriveDefaultPackingProfile exactly for the normalized species + quantity", () => {
    const draft = buildListingDraftFromSpecies(neon, { quantity: 5 });
    const normalized = normalizeSpeciesProfile(neon);
    expect(draft.packingProfile).toEqual(deriveDefaultPackingProfile(normalized, 5));
  });

  it("defaults quantity to 1 and clamps non-positive/invalid quantities up to 1", () => {
    const draft0 = buildListingDraftFromSpecies(neon);
    const draftNeg = buildListingDraftFromSpecies(neon, { quantity: -5 });
    const draftNaN = buildListingDraftFromSpecies(neon, { quantity: "not-a-number" });
    const normalized = normalizeSpeciesProfile(neon);
    const expected = deriveDefaultPackingProfile(normalized, 1);
    expect(draft0.packingProfile).toEqual(expected);
    expect(draftNeg.packingProfile).toEqual(expected);
    expect(draftNaN.packingProfile).toEqual(expected);
  });
});

describe("buildListingDraftFromSpecies — compatibility preview composes buyer engine, not a re-implementation", () => {
  it("with no displayTank, returns the deterministic 'select a tank' placeholder", () => {
    const draft = buildListingDraftFromSpecies(neon);
    expect(draft.compatibilityPreview.verdict).toBe("no_tank");
  });

  it("with a displayTank, returns the same verdict/score buyers would see for this species profile", () => {
    const draft = buildListingDraftFromSpecies(neon, { displayTank: { volume: 20, temp: 24, ph: 6.5 } });
    expect(draft.compatibilityPreview.verdict).toBe("ok");
    expect(draft.compatibilityPreview.score).toBeGreaterThan(0);
  });
});

describe("buildPriceSuggestion (§4.4)", () => {
  const comparables = (cents) => cents.map((c, i) => ({ id: i, speciesId: 42, active: true, priceCentsUSD: c }));

  it("returns median/low/high for a comparable fixture set at or above the sample floor", () => {
    const suggestion = buildPriceSuggestion(comparables([1000, 1500, 2000, 2500]), 42);
    expect(suggestion).not.toBeNull();
    expect(suggestion.low).toBe(1000);
    expect(suggestion.high).toBe(2500);
    expect(suggestion.suggestedCents).toBe(1750); // median of even-length set
    expect(suggestion.basis).toMatch(/4 similar active listings/);
  });

  it("computes the median correctly for an odd-length sample", () => {
    const suggestion = buildPriceSuggestion(comparables([1000, 2000, 3000]), 42);
    expect(suggestion.suggestedCents).toBe(2000);
  });

  it("returns null below the default sample floor (no misleading single-comp number)", () => {
    expect(buildPriceSuggestion(comparables([1000, 1500]), 42)).toBeNull();
    expect(buildPriceSuggestion(comparables([1000]), 42)).toBeNull();
    expect(buildPriceSuggestion([], 42)).toBeNull();
  });

  it("respects a custom sampleFloor", () => {
    expect(buildPriceSuggestion(comparables([1000, 1500]), 42, { sampleFloor: 2 })).not.toBeNull();
  });

  it("filters out inactive listings and mismatched speciesId before sampling", () => {
    const mixed = [
      { speciesId: 42, active: true, priceCentsUSD: 1000 },
      { speciesId: 42, active: true, priceCentsUSD: 1200 },
      { speciesId: 42, active: false, priceCentsUSD: 9999 }, // inactive — excluded
      { speciesId: 99, active: true, priceCentsUSD: 5000 }, // wrong species — excluded
      { speciesId: 42, active: true, priceCentsUSD: 1400 },
    ];
    const suggestion = buildPriceSuggestion(mixed, 42);
    expect(suggestion).not.toBeNull();
    expect(suggestion.low).toBe(1000);
    expect(suggestion.high).toBe(1400);
  });

  it("ignores non-positive or unparseable prices", () => {
    const mixed = [
      { speciesId: 42, active: true, priceCentsUSD: 0 },
      { speciesId: 42, active: true, priceCentsUSD: 1000 },
      { speciesId: 42, active: true, priceCentsUSD: 1200 },
      { speciesId: 42, active: true, priceUsd: "not-a-number" },
      { speciesId: 42, active: true, priceCentsUSD: 1400 },
    ];
    const suggestion = buildPriceSuggestion(mixed, 42);
    expect(suggestion).not.toBeNull();
    expect(suggestion.low).toBe(1000);
  });

  it("is deterministic for identical inputs", () => {
    const a = buildPriceSuggestion(comparables([1000, 1500, 2000, 2500]), 42);
    const b = buildPriceSuggestion(comparables([1000, 1500, 2000, 2500]), 42);
    expect(a).toEqual(b);
  });
});

describe("buildListingDraftFromSpecies — optional price suggestion wiring", () => {
  it("attaches priceSuggestion + suggestedPriceCents when comparables meet the floor", () => {
    const comparables = [
      { speciesId: 1, active: true, priceCentsUSD: 1000 },
      { speciesId: 1, active: true, priceCentsUSD: 1500 },
      { speciesId: 1, active: true, priceCentsUSD: 2000 },
    ];
    const draft = buildListingDraftFromSpecies({ ...neon, speciesId: 1 }, { comparables });
    expect(draft.priceSuggestion).not.toBeNull();
    expect(draft.suggestedPriceCents).toBe(draft.priceSuggestion.suggestedCents);
  });

  it("omits priceSuggestion entirely when no comparables are supplied", () => {
    const draft = buildListingDraftFromSpecies(neon);
    expect(draft.priceSuggestion).toBeNull();
    expect(draft.suggestedPriceCents).toBeUndefined();
  });

  it("priceSuggestion is null (not thrown) below the sample floor", () => {
    const draft = buildListingDraftFromSpecies(
      { ...neon, speciesId: 1 },
      { comparables: [{ speciesId: 1, active: true, priceCentsUSD: 1000 }] }
    );
    expect(draft.priceSuggestion).toBeNull();
  });
});
