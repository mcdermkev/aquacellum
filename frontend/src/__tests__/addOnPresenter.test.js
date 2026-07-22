/**
 * Unit tests for addOnPresenter.js — the pure presentation adapter for the
 * Task 11 UI (box-capacity meter + safe add-on recommendation strip). See
 * docs/TASK_11_RECOMMENDATION_UI_SPEC.md §5.
 *
 * Run with: npx vitest --run src/__tests__/addOnPresenter.test.js
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  buildCandidatesFromListings,
  buildBoxStatus,
  resolveCartItemProfile,
  presentRecommendation,
  capacityCopy,
  addOnCopy,
} from "../services/addOnPresenter.js";
import { recommendAddOns } from "../services/addOnRecommender.js";
import { normalizeParcelPreset, deriveDefaultPackingProfile } from "../services/packingEngine.js";
import { normalizeSpeciesProfile } from "../services/shippingSafety.js";
import { containsProhibitedTerm } from "../services/orderCopy.js";

const preset = normalizeParcelPreset({}); // 40oz / 4 bags / 720in3 / thermal 240 / 6 livestock

function listing(overrides = {}) {
  return {
    tokenId: 101,
    seller: "0xSellerA0000000000000000000000000000001",
    commonName: "Neon Tetra",
    scientificName: "Paracheirodon innesi",
    priceUsd: "12.50",
    isBatch: false,
    active: true,
    minTemp: 22,
    maxTemp: 26,
    minPh: 6,
    maxPh: 7.5,
    ...overrides,
  };
}

function batchListing(overrides = {}) {
  return {
    listingId: 7,
    seller: "0xSellerA0000000000000000000000000000001",
    commonName: "Guppy Fry",
    scientificName: "Poecilia reticulata",
    priceUsd: "3.00",
    quantity: 20,
    isBatch: true,
    isActive: true,
    minTemp: 22,
    maxTemp: 26,
    minPh: 6,
    maxPh: 7.5,
    ...overrides,
  };
}

// ─── 1. Candidate build ──────────────────────────────────────────────────────

describe("buildCandidatesFromListings", () => {
  it("excludes items already in the cart (by listingKey)", () => {
    const listings = [listing({ tokenId: 1 }), listing({ tokenId: 2 })];
    const candidates = buildCandidatesFromListings(listings, ["single-1"]);
    expect(candidates.map((c) => c.listingId)).toEqual(["single-2"]);
  });

  it("excludes inactive/delisted listings", () => {
    const listings = [listing({ tokenId: 1, active: false }), listing({ tokenId: 2 })];
    const candidates = buildCandidatesFromListings(listings, []);
    expect(candidates.map((c) => c.listingId)).toEqual(["single-2"]);
  });

  it("excludes out-of-stock batch listings", () => {
    const listings = [batchListing({ listingId: 1, quantity: 0 }), batchListing({ listingId: 2, quantity: 5 })];
    const candidates = buildCandidatesFromListings(listings, []);
    expect(candidates.map((c) => c.listingId)).toEqual(["batch-2"]);
  });

  it("produces the exact recommendAddOns candidate shape, with price via normalizePriceCents", () => {
    const candidates = buildCandidatesFromListings([listing({ priceUsd: "9.99" })], []);
    expect(candidates[0]).toMatchObject({
      listingId: "single-101",
      priceCents: 999,
      quantityAvailable: 1,
    });
    expect(candidates[0].speciesProfile).toBeDefined();
    expect(candidates[0].speciesProfile.tempRange).toEqual([22, 26]);
  });

  it("resolves quantityAvailable from batch quantity, else 1 for singles", () => {
    const candidates = buildCandidatesFromListings([listing(), batchListing({ quantity: 8 })], []);
    const single = candidates.find((c) => c.listingId === "single-101");
    const batch = candidates.find((c) => c.listingId === "batch-7");
    expect(single.quantityAvailable).toBe(1);
    expect(batch.quantityAvailable).toBe(8);
  });

  it("the resulting candidates feed recommendAddOns without error", () => {
    const candidates = buildCandidatesFromListings([listing(), batchListing()], []);
    const ranked = recommendAddOns(candidates, { preset, cartProfiles: [], buyerTank: { volume: 40, temp: 24, ph: 7 } });
    expect(Array.isArray(ranked)).toBe(true);
  });

  it("handles empty/malformed input without throwing", () => {
    expect(() => buildCandidatesFromListings([], [])).not.toThrow();
    expect(() => buildCandidatesFromListings(undefined, undefined)).not.toThrow();
    expect(() => buildCandidatesFromListings([null, undefined, listing()], [])).not.toThrow();
    expect(buildCandidatesFromListings([null, undefined, listing()], []).length).toBe(1);
  });
});

// ─── 2. Box status ───────────────────────────────────────────────────────────

describe("buildBoxStatus", () => {
  it("matches planParcels' parcel count and usage for a fixture cart", () => {
    const cartItems = [
      { packingProfile: { bagCount: 1, packedWeightOz: 10, volumeIn3: 100, requiresThermalPack: true, livestock: 1 } },
    ];
    const status = buildBoxStatus(cartItems, preset);
    expect(status.parcels).toBe(1);
    expect(status.usage.weightOz).toBe(10);
    expect(status.usage.livestock).toBe(1);
  });

  it("fillPercent reflects the binding constraint and clamps 0-100", () => {
    // Livestock is the binding constraint: 5 of 6 max => ~83%.
    const cartItems = [
      { packingProfile: { bagCount: 1, packedWeightOz: 1, volumeIn3: 1, requiresThermalPack: false, livestock: 5 } },
    ];
    const status = buildBoxStatus(cartItems, preset);
    expect(status.bindingConstraint).toBe("livestock");
    expect(status.fillPercent).toBe(83);
    expect(status.fillPercent).toBeGreaterThanOrEqual(0);
    expect(status.fillPercent).toBeLessThanOrEqual(100);
  });

  it("an empty cart has 0 parcels and 0% fill", () => {
    const status = buildBoxStatus([], preset);
    expect(status.parcels).toBe(0);
    expect(status.fillPercent).toBe(0);
  });

  it("when the cart already spans multiple boxes, fill reflects the last (partial) box, not a cumulative total > 100%", () => {
    // 8 livestock against a 6-max preset -> 2 boxes; the last box holds the
    // remainder (2 of 6 = 33%), not 8/6 (133%, which would be nonsensical).
    const cartItems = [
      { packingProfile: { bagCount: 1, packedWeightOz: 1, volumeIn3: 1, requiresThermalPack: false, livestock: 8 } },
    ];
    const status = buildBoxStatus(cartItems, preset);
    expect(status.parcels).toBe(2);
    expect(status.fillPercent).toBeLessThanOrEqual(100);
    expect(status.fillPercent).toBeGreaterThan(0);
  });

  it("resolveCartItemProfile derives a profile from speciesProfile+quantity when no explicit profile is set", () => {
    const species = normalizeSpeciesProfile({ maxLengthCm: 4, behavior: { temperament: "peaceful" } });
    const item = { speciesProfile: species, quantity: 3 };
    const resolved = resolveCartItemProfile(item);
    const expected = deriveDefaultPackingProfile(species, 3);
    expect(resolved).toEqual(expected);
  });

  it("resolveCartItemProfile prefers an explicit packingProfile when present", () => {
    const explicit = { bagCount: 9, packedWeightOz: 9, volumeIn3: 9, requiresThermalPack: true, livestock: 9 };
    expect(resolveCartItemProfile({ packingProfile: explicit, quantity: 1 })).toEqual(explicit);
  });
});

// ─── 3. Order preserved (no re-sorting/re-scoring) ──────────────────────────

describe("presentRecommendation", () => {
  const peacefulSmall = normalizeSpeciesProfile({
    maxLengthCm: 4,
    tankMetrics: { tempRangeCelsius: [22, 26], phRange: [6, 7], minVolumeGallons: 10 },
    behavior: { temperament: "peaceful" },
  });
  const buyerTank = { volume: 40, temp: 24, ph: 7.0 };

  it("preserves recommendAddOns' exact ranking order", () => {
    const listings = [
      listing({ tokenId: 1, priceUsd: "1.00" }),
      listing({ tokenId: 2, priceUsd: "50.00" }), // higher price -> lower price component -> ranks lower
    ];
    const candidates = buildCandidatesFromListings(listings, []);
    const ranked = recommendAddOns(candidates, { preset, cartProfiles: [], buyerTank });
    const rankedIds = ranked.map((r) => r.listingId);

    const presented = presentRecommendation(ranked, candidates);
    expect(presented.map((p) => p.listingId)).toEqual(rankedIds);
  });

  it("maps addedBox and tankFit.verdict faithfully", () => {
    const forcesBox = {
      listingId: "forces",
      speciesProfile: peacefulSmall,
      packingProfile: { bagCount: 4, packedWeightOz: 35, volumeIn3: 700, requiresThermalPack: true, livestock: 4 },
      quantityAvailable: 5,
      priceCents: 500,
      _listing: { commonName: "Forces", scientificName: "F. forces" },
    };
    const ranked = recommendAddOns([forcesBox], { preset, cartProfiles: [], buyerTank });
    const presented = presentRecommendation(ranked, [forcesBox]);
    expect(presented[0].addedBox).toBe(true);
    expect(presented[0].tankFitVerdict).toBe(ranked[0].tankFit.verdict);
  });

  it("carries display fields (name, price, image) from the joined listing", () => {
    const candidate = {
      listingId: "x",
      speciesProfile: peacefulSmall,
      quantityAvailable: 3,
      priceCents: 1250,
      _listing: { commonName: "Neon Tetra", scientificName: "P. innesi", imageUrl: "http://example.com/img.png" },
    };
    const ranked = recommendAddOns([candidate], { preset, cartProfiles: [], buyerTank });
    const presented = presentRecommendation(ranked, [candidate]);
    expect(presented[0]).toMatchObject({
      commonName: "Neon Tetra",
      scientificName: "P. innesi",
      priceCents: 1250,
      priceDisplay: "$12.50",
      imageUrl: "http://example.com/img.png",
    });
  });

  it("handles an empty ranked list without throwing", () => {
    expect(presentRecommendation([], [])).toEqual([]);
  });
});

// ─── 4. Copy invariant (Web2-safe, all permutations) ────────────────────────

describe("capacityCopy + addOnCopy — Web2 language invariant", () => {
  it("capacityCopy is free of PROHIBITED_TERMS across every box-state permutation (casual + pro)", () => {
    const fixtures = [
      { parcels: 1, remaining: { livestock: 3 }, bindingConstraint: "livestock" },
      { parcels: 1, remaining: { livestock: 0 }, bindingConstraint: "weight" },
      { parcels: 2, remaining: { livestock: 1 }, bindingConstraint: "bags" },
      { parcels: 0, remaining: {}, bindingConstraint: "weight" },
    ];
    for (const fixture of fixtures) {
      for (const casual of [true, false]) {
        const copy = capacityCopy(fixture, { casual });
        expect(containsProhibitedTerm(copy), `capacityCopy(${JSON.stringify(fixture)}, casual=${casual})`).toBe(false);
      }
    }
  });

  it("addOnCopy is free of PROHIBITED_TERMS across every addedBox/tankFitVerdict permutation (casual + pro)", () => {
    for (const addedBox of [true, false]) {
      for (const tankFitVerdict of ["ok", "caution"]) {
        for (const hasBuyerTank of [true, false, undefined]) {
          for (const casual of [true, false]) {
            const { boxLabel, tankFitLabel } = addOnCopy({ addedBox, tankFitVerdict, hasBuyerTank }, { casual });
            expect(containsProhibitedTerm(boxLabel)).toBe(false);
            if (tankFitLabel) expect(containsProhibitedTerm(tankFitLabel)).toBe(false);
          }
        }
      }
    }
  });

  it("addOnCopy never fabricates a tank-fit verdict when no buyer tank is selected", () => {
    const { tankFitLabel } = addOnCopy({ addedBox: false, tankFitVerdict: "ok", hasBuyerTank: false });
    expect(tankFitLabel).toMatch(/select a tank/i);
  });

  it("addOnCopy discloses the box cost honestly (never silent about +shipping)", () => {
    const { boxLabel } = addOnCopy({ addedBox: true, tankFitVerdict: "ok" }, { casual: true });
    expect(boxLabel.toLowerCase()).toMatch(/box|parcel/);
    expect(boxLabel.toLowerCase()).toMatch(/shipping/);
  });
});

// ─── 5. Engine-composition guard ─────────────────────────────────────────────

describe("addOnPresenter.js — engine-composition guard (no forked safety/packing logic)", () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL("../services/addOnPresenter.js", import.meta.url)),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("imports the four engines rather than reimplementing them", () => {
    expect(SOURCE).toContain('from "./packingEngine.js"');
    expect(SOURCE).toContain('from "./parcelPlanner.js"');
    expect(SOURCE).toContain('from "./shippingSafety.js"');
    expect(SOURCE).toContain("planParcels(");
    expect(SOURCE).toContain("deriveDefaultPackingProfile(");
    expect(SOURCE).toContain("normalizeSpeciesProfile(");
  });

  it("does not import or call recommendAddOns/evaluateTankFit itself (that's the hook's job, composing this + the engine)", () => {
    // The presenter only JOINS recommendAddOns' output (via presentRecommendation);
    // it must not call the ranker itself, which would blur "who calls the engine."
    expect(SOURCE).not.toContain("addOnRecommender.js");
  });

  it("contains no local safety/threshold constants (block ratios, temp/pH deltas, score thresholds)", () => {
    expect(SOURCE).not.toMatch(/BLOCK_VOLUME_RATIO|BLOCK_TEMP_DELTA|BLOCK_PH_DELTA|CAUTION_SCORE_THRESHOLD/);
  });

  it("contains no local box-count/rate math (boxesRequired is only ever imported, never redefined)", () => {
    expect(SOURCE).not.toMatch(/function\s+boxesRequired/);
    expect(SOURCE).not.toMatch(/function\s+canAddToParcel/);
  });
});
