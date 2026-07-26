import { describe, it, expect } from "vitest";
import {
  buildSpeciesAvailability,
  getAvailabilityFor,
  summarizeAvailability,
} from "./speciesAvailability.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────
// Listing shapes mirror what listingManager.fetchListingsByBreed / cloud / local
// produce: on-chain speciesId, scientificName, seller, priceCentsUSD (single) or
// pricePerFishCents + quantity (batch), isBatch, active/isActive, isShipping.

const single = (over = {}) => ({
  id: 1, tokenId: 1, isBatch: false,
  seller: "0xSellerA",
  speciesId: 3, scientificName: "Betta splendens", commonName: "Betta",
  priceCentsUSD: 1500,
  isShipping: true,
  ...over,
});

const batch = (over = {}) => ({
  id: 1, listingId: 1, isBatch: true,
  seller: "0xSellerB",
  speciesId: 3, scientificName: "Betta splendens", commonName: "Betta",
  pricePerFishCents: 800, quantity: 6,
  isActive: true, isShipping: false,
  ...over,
});

describe("buildSpeciesAvailability", () => {
  it("aggregates listing count, distinct sellers, units, and min price per species", () => {
    const { bySpeciesId } = buildSpeciesAvailability([
      single({ tokenId: 1, seller: "0xA", priceCentsUSD: 1500 }),
      single({ tokenId: 2, seller: "0xA", priceCentsUSD: 1200 }), // same seller, cheaper
      batch({ listingId: 1, seller: "0xB", pricePerFishCents: 800, quantity: 6 }),
    ]);
    const p = bySpeciesId.get(3);
    expect(p.listingCount).toBe(3);
    expect(p.sellerCount).toBe(2);            // 0xA and 0xB
    expect(p.unitsAvailable).toBe(1 + 1 + 6); // two singles + batch of 6
    expect(p.fromPriceCents).toBe(800);        // cheapest across all
    expect(p.fromPriceDisplay).toBe("$8.00");
    expect(p.hasShipping).toBe(true);          // one single ships
  });

  it("counts sellers case-insensitively and tolerates seller field variants", () => {
    const { bySpeciesId } = buildSpeciesAvailability([
      single({ tokenId: 1, seller: "0xABC" }),
      single({ tokenId: 2, seller: "0xabc" }),          // same seller, different case
      single({ tokenId: 3, seller: undefined, sellerAddress: "0xDEF" }),
    ]);
    expect(bySpeciesId.get(3).sellerCount).toBe(2);
  });

  it("excludes inactive/sold listings", () => {
    const { bySpeciesId } = buildSpeciesAvailability([
      single({ tokenId: 1, active: false }),
      batch({ listingId: 1, isActive: false }),
    ]);
    expect(bySpeciesId.get(3)).toBeUndefined();
  });

  it("excludes active-but-empty batches, and ignores non-positive prices for 'from'", () => {
    const { bySpeciesId } = buildSpeciesAvailability([
      batch({ listingId: 1, quantity: 0 }),                 // out of stock → excluded
      single({ tokenId: 5, priceCentsUSD: 0, seller: "0xZ" }), // free/unpriced → counts, but not the 'from'
      single({ tokenId: 6, priceCentsUSD: 2200, seller: "0xY" }),
    ]);
    const p = bySpeciesId.get(3);
    expect(p.listingCount).toBe(2);          // the two singles, not the empty batch
    expect(p.unitsAvailable).toBe(2);
    expect(p.fromPriceCents).toBe(2200);     // the $0 listing is ignored for 'from'
  });

  it("indexes by both speciesId and lowercased scientific name", () => {
    const { bySpeciesId, byScientificName } = buildSpeciesAvailability([single()]);
    expect(bySpeciesId.get(3).listingCount).toBe(1);
    expect(byScientificName.get("betta splendens").listingCount).toBe(1);
  });

  it("de-duplicates a batch and a single that share a numeric id (distinct listing keys)", () => {
    // batch listingId 1 and single tokenId 1 must both count (getListingKey differs).
    const { bySpeciesId } = buildSpeciesAvailability([single({ tokenId: 1 }), batch({ listingId: 1 })]);
    expect(bySpeciesId.get(3).listingCount).toBe(2);
  });

  it("returns empty maps for empty/invalid input", () => {
    expect(buildSpeciesAvailability([]).bySpeciesId.size).toBe(0);
    expect(buildSpeciesAvailability(null).byScientificName.size).toBe(0);
  });
});

describe("getAvailabilityFor", () => {
  const index = buildSpeciesAvailability([single({ speciesId: 3, scientificName: "Betta splendens" })]);

  it("matches by numeric speciesId", () => {
    expect(getAvailabilityFor(index, { speciesId: 3 }).listingCount).toBe(1);
  });

  it("falls back to scientific name when the id doesn't match (global specCode vs on-chain id)", () => {
    // A curated global entry keyed by FishBase specCode (e.g. 5000) that doesn't
    // match the on-chain listing id (3), but shares the scientific name.
    const p = getAvailabilityFor(index, { speciesId: 5000, scientificName: "Betta splendens" });
    expect(p).toBeTruthy();
    expect(p.listingCount).toBe(1);
  });

  it("returns null when the species has no active listings", () => {
    expect(getAvailabilityFor(index, { speciesId: 999, scientificName: "Nope nope" })).toBeNull();
    expect(getAvailabilityFor(null, { speciesId: 3 })).toBeNull();
  });
});

describe("summarizeAvailability", () => {
  it("renders sellers + from-price with correct pluralization", () => {
    const index = buildSpeciesAvailability([
      single({ tokenId: 1, seller: "0xA", priceCentsUSD: 1250 }),
      single({ tokenId: 2, seller: "0xB", priceCentsUSD: 3000 }),
    ]);
    expect(summarizeAvailability(index.bySpeciesId.get(3))).toBe("Available from 2 sellers · from $12.50");
  });

  it("uses the singular 'seller' for one seller", () => {
    const index = buildSpeciesAvailability([single({ seller: "0xA", priceCentsUSD: 999 })]);
    expect(summarizeAvailability(index.bySpeciesId.get(3))).toBe("Available from 1 seller · from $9.99");
  });

  it("omits the price clause when no positive price is known", () => {
    const index = buildSpeciesAvailability([single({ seller: "0xA", priceCentsUSD: 0 })]);
    expect(summarizeAvailability(index.bySpeciesId.get(3))).toBe("Available from 1 seller");
  });

  it("returns null when there's nothing to show", () => {
    expect(summarizeAvailability(null)).toBeNull();
    expect(summarizeAvailability({ listingCount: 0, sellerCount: 0 })).toBeNull();
  });
});
