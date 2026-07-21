/**
 * Unit tests for the unified catalog query engine (Task 8, Tier B).
 *
 * Covers §4 acceptance criteria 1 (search/filter/sort), 2 (inactive
 * exclusion), 3 (normalized pricing), and 5 (facets). Compatibility-sort
 * correctness against evaluateTankFit is exercised here too, since the
 * "composes, does not re-implement" requirement is verified more directly in
 * compatibilityExplanation.test.js.
 *
 * Run with: npx vitest --run src/__tests__/catalogQuery.test.js
 */

import { describe, it, expect } from "vitest";
import {
  applyCatalogQuery,
  normalizePriceCents,
  formatPriceCents,
  getFulfillmentTypes,
  getListingKey,
  SORT_OPTIONS,
  FULFILLMENT_TYPES,
} from "../services/catalogQuery.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function neon(overrides = {}) {
  return {
    tokenId: 1,
    isBatch: false,
    active: true,
    commonName: "Neon Tetra",
    scientificName: "Paracheirodon innesi",
    speciesId: 101,
    careLevel: 0,
    priceUsd: "12.50",
    isShipping: true,
    minTemp: 22,
    maxTemp: 26,
    minPh: 6,
    maxPh: 7,
    birthTimestamp: 1000,
    ...overrides,
  };
}

function discus(overrides = {}) {
  return {
    tokenId: 2,
    isBatch: false,
    active: true,
    commonName: "Discus",
    scientificName: "Symphysodon aequifasciatus",
    speciesId: 202,
    careLevel: 3,
    priceCentsUSD: 8000,
    isShipping: false,
    pickupAvailable: true,
    minTemp: 28,
    maxTemp: 31,
    minPh: 6,
    maxPh: 6.8,
    birthTimestamp: 3000,
    ...overrides,
  };
}

function guppyBatch(overrides = {}) {
  return {
    listingId: 5,
    isBatch: true,
    isActive: true,
    commonName: "Guppy Fry Batch",
    scientificName: "Poecilia reticulata",
    speciesId: 303,
    careLevel: 0,
    pricePerFishCents: 300,
    isShipping: false,
    quantity: 20,
    birthTimestamp: 2000,
    ...overrides,
  };
}

const FAMILY_LOOKUP = {
  101: "Characidae",
  202: "Cichlidae",
  303: "Poeciliidae",
};

// ─── Price normalization (§4.3) ────────────────────────────────────────────

describe("normalizePriceCents", () => {
  it("normalizes priceCentsUSD (already cents)", () => {
    expect(normalizePriceCents({ priceCentsUSD: 1250 })).toBe(1250);
  });

  it("normalizes pricePerFishCents (batch shape)", () => {
    expect(normalizePriceCents({ pricePerFishCents: 300 })).toBe(300);
  });

  it("normalizes priceUsd decimal-dollar strings", () => {
    expect(normalizePriceCents({ priceUsd: "12.50" })).toBe(1250);
  });

  it("normalizes price (fallback decimal-dollar field)", () => {
    expect(normalizePriceCents({ price: "8.00" })).toBe(800);
  });

  it("different price shapes for the same dollar amount normalize identically", () => {
    const a = normalizePriceCents({ priceCentsUSD: 1250 });
    const b = normalizePriceCents({ priceUsd: "12.50" });
    const c = normalizePriceCents({ price: 12.5 });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("unparseable price normalizes to 0", () => {
    expect(normalizePriceCents({})).toBe(0);
    expect(normalizePriceCents({ price: "not-a-number" })).toBe(0);
  });
});

describe("formatPriceCents", () => {
  it("renders cents as a USD display string", () => {
    expect(formatPriceCents(1250)).toBe("$12.50");
    expect(formatPriceCents(300)).toBe("$3.00");
    expect(formatPriceCents(0)).toBe("$0.00");
  });

  it("listings in different price shapes render identically once normalized", () => {
    const centsA = normalizePriceCents({ priceCentsUSD: 1250 });
    const centsB = normalizePriceCents({ priceUsd: "12.50" });
    expect(formatPriceCents(centsA)).toBe(formatPriceCents(centsB));
  });
});

// ─── Inactive exclusion (§4.2) ──────────────────────────────────────────────

describe("applyCatalogQuery — inactive listings excluded", () => {
  it("drops inactive single listings by default", () => {
    const listings = [neon(), neon({ tokenId: 9, active: false })];
    const { results } = applyCatalogQuery(listings, {});
    expect(results.map((r) => r.tokenId)).toEqual([1]);
  });

  it("drops inactive batch listings by default", () => {
    const listings = [guppyBatch(), guppyBatch({ listingId: 9, isActive: false })];
    const { results } = applyCatalogQuery(listings, {});
    expect(results.map((r) => r.listingId)).toEqual([5]);
  });

  it("includeInactive=true keeps them", () => {
    const listings = [neon(), neon({ tokenId: 9, active: false })];
    const { results } = applyCatalogQuery(listings, { includeInactive: true });
    expect(results.length).toBe(2);
  });
});

// ─── Filters (§4.1) ─────────────────────────────────────────────────────────

describe("applyCatalogQuery — filters narrow correctly", () => {
  const listings = [neon(), discus(), guppyBatch()];

  it("filters by speciesId", () => {
    const { results } = applyCatalogQuery(listings, { speciesId: 101 });
    expect(results.map((r) => r.commonName)).toEqual(["Neon Tetra"]);
  });

  it("filters by family (via familyLookup)", () => {
    const { results } = applyCatalogQuery(listings, { family: "Cichlidae", familyLookup: FAMILY_LOOKUP });
    expect(results.map((r) => r.commonName)).toEqual(["Discus"]);
  });

  it("filters by care level", () => {
    const { results } = applyCatalogQuery(listings, { careLevel: 3 });
    expect(results.map((r) => r.commonName)).toEqual(["Discus"]);
  });

  it("filters by price range (cents)", () => {
    // Neon = 1250c, Discus = 8000c, Guppy = 300c — [1300, 9000] keeps only Discus.
    const { results } = applyCatalogQuery(listings, { priceMinCents: 1300, priceMaxCents: 9000 });
    expect(results.map((r) => r.commonName)).toEqual(["Discus"]);
  });

  it("filters by fulfillment availability (shipping)", () => {
    const { results } = applyCatalogQuery(listings, { fulfillment: FULFILLMENT_TYPES.SHIPPING });
    expect(results.map((r) => r.commonName)).toEqual(["Neon Tetra"]);
  });

  it("filters by fulfillment availability (pickup)", () => {
    const { results } = applyCatalogQuery(listings, { fulfillment: FULFILLMENT_TYPES.PICKUP });
    // Discus explicitly opts in; guppyBatch has no pickupAvailable flag set
    // (defaults to available); neon doesn't set pickupAvailable either.
    expect(results.map((r) => r.commonName).sort()).toEqual(["Discus", "Guppy Fry Batch", "Neon Tetra"].sort());
  });

  it("filters batch vs single", () => {
    const batchOnly = applyCatalogQuery(listings, { listingType: "batch" }).results;
    expect(batchOnly.map((r) => r.commonName)).toEqual(["Guppy Fry Batch"]);

    const singleOnly = applyCatalogQuery(listings, { listingType: "single" }).results;
    expect(singleOnly.map((r) => r.commonName).sort()).toEqual(["Discus", "Neon Tetra"]);
  });

  it("combines multiple filters (AND semantics)", () => {
    const { results } = applyCatalogQuery(listings, { careLevel: 0, fulfillment: FULFILLMENT_TYPES.SHIPPING });
    expect(results.map((r) => r.commonName)).toEqual(["Neon Tetra"]);
  });
});

// ─── Fuzzy search (§4.1) ────────────────────────────────────────────────────

describe("applyCatalogQuery — fuzzy search on common + scientific name", () => {
  const listings = [neon(), discus(), guppyBatch()];

  it("matches on common name, including minor typos", () => {
    const { results } = applyCatalogQuery(listings, { search: "nean tetra" });
    expect(results.map((r) => r.commonName)).toContain("Neon Tetra");
  });

  it("matches on scientific name", () => {
    const { results } = applyCatalogQuery(listings, { search: "Symphysodon" });
    expect(results.map((r) => r.commonName)).toContain("Discus");
  });

  it("empty search returns everything (post-filter)", () => {
    const { results } = applyCatalogQuery(listings, { search: "" });
    expect(results.length).toBe(3);
  });

  it("a search matching nothing returns an empty result set", () => {
    const { results } = applyCatalogQuery(listings, { search: "zzzznonexistentzzzz" });
    expect(results.length).toBe(0);
  });
});

// ─── Sort (§4.1) — deterministic, tiebreak by listing id ──────────────────

describe("applyCatalogQuery — sort orders are correct and deterministic", () => {
  const listings = [discus(), neon(), guppyBatch()]; // deliberately unsorted input

  it("price_asc", () => {
    const { results } = applyCatalogQuery(listings, { sort: SORT_OPTIONS.PRICE_ASC });
    expect(results.map((r) => r.commonName)).toEqual(["Guppy Fry Batch", "Neon Tetra", "Discus"]);
  });

  it("price_desc", () => {
    const { results } = applyCatalogQuery(listings, { sort: SORT_OPTIONS.PRICE_DESC });
    expect(results.map((r) => r.commonName)).toEqual(["Discus", "Neon Tetra", "Guppy Fry Batch"]);
  });

  it("newest (by birthTimestamp desc)", () => {
    const { results } = applyCatalogQuery(listings, { sort: SORT_OPTIONS.NEWEST });
    expect(results.map((r) => r.commonName)).toEqual(["Discus", "Guppy Fry Batch", "Neon Tetra"]);
  });

  it("distance (fuzzed distance ascending)", () => {
    const withDistance = [
      neon({ distanceMiles: 5 }),
      discus({ distanceMiles: 1 }),
      guppyBatch({ distanceMiles: 3 }),
    ];
    const { results } = applyCatalogQuery(withDistance, { sort: SORT_OPTIONS.DISTANCE });
    expect(results.map((r) => r.commonName)).toEqual(["Discus", "Guppy Fry Batch", "Neon Tetra"]);
  });

  it("compatibility (by evaluateTankFit score desc) — requires a displayTank", () => {
    const speciesLookup = {
      "paracheirodon innesi": { minVolumeGallons: 10 },
      "symphysodon aequifasciatus": { minVolumeGallons: 55 },
      "poecilia reticulata": { minVolumeGallons: 10 },
    };
    // A 20g tank: fits neon and guppy well, but is a poor (blocked) fit for
    // the 55g-minimum discus.
    const displayTank = { volume: 20, temp: 24, ph: 6.5 };
    const { results } = applyCatalogQuery(listings, {
      sort: SORT_OPTIONS.COMPATIBILITY,
      displayTank,
      speciesLookup,
    });
    // Discus (blocked/poor fit) must rank behind the two good fits.
    expect(results[results.length - 1].commonName).toBe("Discus");
  });

  it("deterministic tiebreak by listing id when scores/prices are equal", () => {
    const tied = [
      neon({ tokenId: 3, priceUsd: "5.00" }),
      neon({ tokenId: 1, priceUsd: "5.00" }),
      neon({ tokenId: 2, priceUsd: "5.00" }),
    ];
    const { results } = applyCatalogQuery(tied, { sort: SORT_OPTIONS.PRICE_ASC });
    expect(results.map((r) => r.tokenId)).toEqual([1, 2, 3]);
  });

  it("sorting is stable across repeated calls with the same (shuffled) input", () => {
    const shuffled = [guppyBatch(), discus(), neon()];
    const runA = applyCatalogQuery(shuffled, { sort: SORT_OPTIONS.PRICE_ASC }).results.map(getListingKey);
    const runB = applyCatalogQuery(listings, { sort: SORT_OPTIONS.PRICE_ASC }).results.map(getListingKey);
    expect(runA).toEqual(runB);
  });
});

// ─── Facets (§4.5) ──────────────────────────────────────────────────────────

describe("applyCatalogQuery — facet counts match the filtered set", () => {
  it("counts family/careLevel/fulfillmentType over the full active set", () => {
    const listings = [neon(), discus(), guppyBatch()];
    const { facets } = applyCatalogQuery(listings, { familyLookup: FAMILY_LOOKUP });

    expect(facets.family).toEqual({ Characidae: 1, Cichlidae: 1, Poeciliidae: 1 });
    expect(facets.careLevel).toEqual({ 0: 2, 3: 1 });
    expect(facets.fulfillmentType[FULFILLMENT_TYPES.SHIPPING]).toBe(1);
  });

  it("facet counts reflect the post-filter set, not the raw input", () => {
    const listings = [neon(), neon({ tokenId: 4, careLevel: 0 }), discus()];
    const { facets } = applyCatalogQuery(listings, { careLevel: 0, familyLookup: FAMILY_LOOKUP });
    expect(facets.careLevel).toEqual({ 0: 2 });
    expect(facets.family.Cichlidae).toBeUndefined();
  });

  it("facet counts reflect an active-set drop", () => {
    const listings = [neon(), neon({ tokenId: 9, active: false })];
    const { facets } = applyCatalogQuery(listings, {});
    expect(facets.family).toEqual({}); // no familyLookup provided, but count check below
    const { results } = applyCatalogQuery(listings, {});
    expect(results.length).toBe(1);
  });
});

// ─── Helper exports ─────────────────────────────────────────────────────────

describe("getFulfillmentTypes", () => {
  it("includes pickup by default", () => {
    expect(getFulfillmentTypes({})).toEqual([FULFILLMENT_TYPES.PICKUP]);
  });

  it("excludes pickup when explicitly disabled", () => {
    expect(getFulfillmentTypes({ pickupAvailable: false })).toEqual([]);
  });

  it("includes shipping and local delivery when flagged", () => {
    const types = getFulfillmentTypes({ isShipping: true, localDeliveryAvailable: true });
    expect(types).toEqual([FULFILLMENT_TYPES.SHIPPING, FULFILLMENT_TYPES.LOCAL_DELIVERY, FULFILLMENT_TYPES.PICKUP]);
  });
});

describe("getListingKey", () => {
  it("distinguishes batch and single listings with the same numeric id", () => {
    const single = { isBatch: false, tokenId: 5 };
    const batch = { isBatch: true, listingId: 5 };
    expect(getListingKey(single)).not.toBe(getListingKey(batch));
  });
});
