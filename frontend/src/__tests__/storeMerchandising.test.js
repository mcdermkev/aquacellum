/**
 * Unit tests for storeMerchandising.js — the pure core for Task 21A
 * (storefront merchandising: featured collections & customizable sections).
 * See docs/TASK_21A_MERCHANDISING_SPEC.md §6.
 *
 * Run with: npx vitest --run src/__tests__/storeMerchandising.test.js
 */

import { describe, it, expect } from "vitest";
import {
  assembleStorefrontLayout,
  normalizeSection,
  validateSectionDraft,
  validateSectionsPayload,
  SECTION_TYPES,
  SECTION_COPY,
  ALL_LISTINGS_SECTION_TYPE,
  MAX_SECTIONS,
  MAX_TITLE_LENGTH,
  MAX_LISTING_REFS,
} from "../services/storeMerchandising.js";
import { getListingKey } from "../services/catalogQuery.js";
import { containsProhibitedTerm } from "../services/orderCopy.js";

function single(tokenId, overrides = {}) {
  return { tokenId, isBatch: false, active: true, commonName: `Fish ${tokenId}`, priceUsd: "10.00", ...overrides };
}

function batch(listingId, overrides = {}) {
  return { listingId, isBatch: true, isActive: true, commonName: `Batch ${listingId}`, priceUsd: "5.00", quantity: 4, ...overrides };
}

// ─── 1. assembleStorefrontLayout ─────────────────────────────────────────────

describe("assembleStorefrontLayout", () => {
  const s1 = single(1);
  const s2 = single(2);
  const s3 = single(3, { active: false }); // inactive
  const b1 = batch(10);

  it("orders featured sections before collections/custom sections", () => {
    const sections = [
      { id: "col-1", type: SECTION_TYPES.COLLECTION, title: "Collection", listingRefs: [getListingKey(s1)], sortOrder: 0, visible: true },
      { id: "feat-1", type: SECTION_TYPES.FEATURED, title: "Featured", listingRefs: [getListingKey(s2)], sortOrder: 1, visible: true },
    ];
    const out = assembleStorefrontLayout(null, [s1, s2], sections);
    expect(out[0].id).toBe("feat-1");
    expect(out[1].id).toBe("col-1");
  });

  it("orders collections/custom sections by sort_order among themselves", () => {
    const sections = [
      { id: "col-b", type: SECTION_TYPES.COLLECTION, title: "B", listingRefs: [getListingKey(s1)], sortOrder: 2, visible: true },
      { id: "col-a", type: SECTION_TYPES.COLLECTION, title: "A", listingRefs: [getListingKey(s2)], sortOrder: 1, visible: true },
    ];
    const out = assembleStorefrontLayout(null, [s1, s2], sections);
    expect(out.map((s) => s.id)).toEqual(["col-a", "col-b"]);
  });

  it("appends a catch-all 'All listings' section with everything not already placed", () => {
    const sections = [
      { id: "feat-1", type: SECTION_TYPES.FEATURED, title: "Featured", listingRefs: [getListingKey(s1)], sortOrder: 0, visible: true },
    ];
    const out = assembleStorefrontLayout(null, [s1, s2, b1], sections);
    const catchAll = out.find((s) => s.type === ALL_LISTINGS_SECTION_TYPE);
    expect(catchAll).toBeDefined();
    expect(catchAll.title).toBe(SECTION_COPY.allListingsTitle);
    expect(catchAll.listings.map(getListingKey).sort()).toEqual([getListingKey(s2), getListingKey(b1)].sort());
  });

  it("omits the catch-all section entirely when nothing remains unplaced", () => {
    const sections = [
      { id: "feat-1", type: SECTION_TYPES.FEATURED, title: "Featured", listingRefs: [getListingKey(s1)], sortOrder: 0, visible: true },
    ];
    const out = assembleStorefrontLayout(null, [s1], sections);
    expect(out.some((s) => s.type === ALL_LISTINGS_SECTION_TYPE)).toBe(false);
  });

  it("resolves listing_refs to live listings via getListingKey (snake_case rows)", () => {
    const sections = [
      { id: "feat-1", type: "featured", title: "Featured", listing_refs: [getListingKey(s1), getListingKey(b1)], sort_order: 0, visible: true },
    ];
    const out = assembleStorefrontLayout(null, [s1, b1], sections);
    expect(out[0].listings.map(getListingKey).sort()).toEqual([getListingKey(s1), getListingKey(b1)].sort());
  });

  it("drops inactive listings from a section's resolved output", () => {
    const sections = [
      { id: "feat-1", type: SECTION_TYPES.FEATURED, title: "Featured", listingRefs: [getListingKey(s1), getListingKey(s3)], sortOrder: 0, visible: true },
    ];
    const out = assembleStorefrontLayout(null, [s1, s3], sections);
    expect(out[0].listings.map(getListingKey)).toEqual([getListingKey(s1)]);
  });

  it("drops refs to listings missing from the live listing set", () => {
    const sections = [
      { id: "feat-1", type: SECTION_TYPES.FEATURED, title: "Featured", listingRefs: [getListingKey(s1), "single-999"], sortOrder: 0, visible: true },
    ];
    const out = assembleStorefrontLayout(null, [s1], sections);
    expect(out[0].listings.map(getListingKey)).toEqual([getListingKey(s1)]);
  });

  it("drops a section entirely once it becomes empty (all refs inactive/missing)", () => {
    const sections = [
      { id: "feat-1", type: SECTION_TYPES.FEATURED, title: "Featured", listingRefs: [getListingKey(s3)], sortOrder: 0, visible: true },
      { id: "col-1", type: SECTION_TYPES.COLLECTION, title: "Collection", listingRefs: [getListingKey(s1)], sortOrder: 1, visible: true },
    ];
    const out = assembleStorefrontLayout(null, [s1, s3], sections);
    expect(out.find((s) => s.id === "feat-1")).toBeUndefined();
    expect(out.find((s) => s.id === "col-1")).toBeDefined();
  });

  it("skips hidden (visible=false) sections entirely", () => {
    const sections = [
      { id: "feat-1", type: SECTION_TYPES.FEATURED, title: "Featured", listingRefs: [getListingKey(s1)], sortOrder: 0, visible: false },
    ];
    const out = assembleStorefrontLayout(null, [s1], sections);
    expect(out.find((s) => s.id === "feat-1")).toBeUndefined();
    // s1 falls through to the catch-all since the hiding section never placed it.
    expect(out[0].type).toBe(ALL_LISTINGS_SECTION_TYPE);
  });

  it("is deterministic for identical inputs", () => {
    const sections = [
      { id: "feat-1", type: SECTION_TYPES.FEATURED, title: "Featured", listingRefs: [getListingKey(s1)], sortOrder: 0, visible: true },
      { id: "col-1", type: SECTION_TYPES.COLLECTION, title: "Collection", listingRefs: [getListingKey(s2)], sortOrder: 1, visible: true },
    ];
    const out1 = assembleStorefrontLayout(null, [s1, s2, b1], sections);
    const out2 = assembleStorefrontLayout(null, [s1, s2, b1], sections);
    expect(out1).toEqual(out2);
  });

  it("never mutates the input listings or sections arrays", () => {
    const sections = [
      { id: "feat-1", type: SECTION_TYPES.FEATURED, title: "Featured", listingRefs: [getListingKey(s1)], sortOrder: 0, visible: true },
    ];
    const listingsCopy = [s1, s2];
    const sectionsCopy = JSON.parse(JSON.stringify(sections));
    assembleStorefrontLayout(null, listingsCopy, sections);
    expect(listingsCopy).toEqual([s1, s2]);
    expect(sections).toEqual(sectionsCopy);
  });

  it("handles empty/malformed inputs without throwing", () => {
    expect(() => assembleStorefrontLayout(null)).not.toThrow();
    expect(() => assembleStorefrontLayout(null, [], [])).not.toThrow();
    expect(() => assembleStorefrontLayout(null, [s1], null)).not.toThrow();
    expect(assembleStorefrontLayout(null, [], [])).toEqual([]);
  });
});

// ─── 2. normalizeSection ─────────────────────────────────────────────────────

describe("normalizeSection", () => {
  it("normalizes a snake_case DB row to camelCase", () => {
    const row = {
      id: "abc",
      wallet_address: "0xABC",
      type: "collection",
      title: "My Collection",
      listing_refs: ["single-1"],
      sort_order: 3,
      visible: true,
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
    };
    expect(normalizeSection(row)).toEqual({
      id: "abc",
      walletAddress: "0xabc",
      type: "collection",
      title: "My Collection",
      listingRefs: ["single-1"],
      sortOrder: 3,
      visible: true,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    });
  });

  it("passes through an already-camelCase draft unchanged in shape", () => {
    const draft = { type: "featured", title: "Featured", listingRefs: ["single-2"], sortOrder: 0, visible: false };
    const normalized = normalizeSection(draft);
    expect(normalized.type).toBe("featured");
    expect(normalized.listingRefs).toEqual(["single-2"]);
    expect(normalized.visible).toBe(false);
  });

  it("defaults an invalid/missing type to collection, sortOrder to 0, visible to true", () => {
    const normalized = normalizeSection({ title: "X" });
    expect(normalized.type).toBe(SECTION_TYPES.COLLECTION);
    expect(normalized.sortOrder).toBe(0);
    expect(normalized.visible).toBe(true);
  });
});

// ─── 3. validateSectionDraft / validateSectionsPayload ──────────────────────

describe("validateSectionDraft", () => {
  it("accepts a well-formed featured draft", () => {
    expect(validateSectionDraft({ type: SECTION_TYPES.FEATURED, title: "Featured", listingRefs: ["single-1"] })).toEqual({ ok: true, error: null });
  });

  it("rejects a bad type", () => {
    const result = validateSectionDraft({ type: "not-a-real-type" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/type must be one of/);
  });

  it("rejects an over-long title", () => {
    const result = validateSectionDraft({ type: SECTION_TYPES.COLLECTION, title: "x".repeat(MAX_TITLE_LENGTH + 1) });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/60 characters/);
  });

  it("rejects an oversized listingRefs array", () => {
    const result = validateSectionDraft({ type: SECTION_TYPES.COLLECTION, listingRefs: Array.from({ length: MAX_LISTING_REFS + 1 }, (_, i) => `single-${i}`) });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/100 or fewer/);
  });

  it("rejects listingRefs containing non-string entries", () => {
    const result = validateSectionDraft({ type: SECTION_TYPES.COLLECTION, listingRefs: [123, "single-1"] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only strings/);
  });

  it("rejects a non-string title", () => {
    const result = validateSectionDraft({ type: SECTION_TYPES.COLLECTION, title: 42 });
    expect(result.ok).toBe(false);
  });
});

describe("validateSectionsPayload", () => {
  it("accepts an empty array", () => {
    expect(validateSectionsPayload([])).toEqual({ ok: true, error: null });
  });

  it("rejects a non-array payload", () => {
    expect(validateSectionsPayload("nope").ok).toBe(false);
  });

  it("rejects more than MAX_SECTIONS sections", () => {
    const many = Array.from({ length: MAX_SECTIONS + 1 }, () => ({ type: SECTION_TYPES.COLLECTION }));
    const result = validateSectionsPayload(many);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/20 sections/);
  });

  it("rejects the whole payload if any single draft is invalid", () => {
    const result = validateSectionsPayload([{ type: SECTION_TYPES.COLLECTION }, { type: "garbage" }]);
    expect(result.ok).toBe(false);
  });
});

// ─── 4. Web2 language invariant ──────────────────────────────────────────────

describe("SECTION_COPY — Web2 language invariant", () => {
  it("every copy string is free of PROHIBITED_TERMS", () => {
    for (const [key, value] of Object.entries(SECTION_COPY)) {
      expect(containsProhibitedTerm(value), `SECTION_COPY.${key} = "${value}"`).toBe(false);
    }
  });
});
