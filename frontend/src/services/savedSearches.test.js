/**
 * Tests for services/savedSearches.js.
 *
 * The defect being closed was that this data was WRITE-ONLY: the marketplace board
 * appended filter sets and nothing ever read one back, on a capability gated behind
 * an EARNED entitlement. So the cases that matter are about a saved record still
 * being usable later:
 *
 *   - NORMALIZATION. Records already exist in users' browsers and may be missing
 *     fields. Applying a PARTIAL filter set would leave the user's current
 *     selections in place, so the restored results would not match what they saved.
 *     A complete set is what makes "run" deterministic.
 *   - DE-DUPLICATION. The save button is one click with no preview of what is
 *     already stored, so identical saves must collapse rather than pile up.
 *   - CORRUPTION TOLERANCE. This is read during render; a bad JSON blob must not
 *     throw into the component tree.
 */

import { describe, it, expect, vi } from "vitest";
import {
  MAX_SAVED_SEARCHES,
  SAVED_SEARCHES_KEY,
  addSavedSearch,
  describeSavedSearch,
  loadSavedSearches,
  normalizeSearch,
  removeSavedSearch,
} from "./savedSearches.js";

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: vi.fn((k) => (k in store ? store[k] : null)),
    setItem: vi.fn((k, v) => { store[k] = String(v); }),
    removeItem: vi.fn((k) => { delete store[k]; }),
    _store: store,
  };
}

function withSearches(list) {
  return fakeStorage({ [SAVED_SEARCHES_KEY]: JSON.stringify(list) });
}

const FULL = {
  search: "guppy",
  family: "Poeciliidae",
  careLevel: "Beginner",
  fulfillment: "shipped",
  priceMinInput: "10",
  priceMaxInput: "40",
};

describe("normalizeSearch", () => {
  it("fills every missing field with the board's defaults", () => {
    // The whole point: an incomplete set would leave stale filters applied.
    expect(normalizeSearch({})).toEqual({
      search: "",
      family: "all",
      careLevel: "all",
      fulfillment: "all",
      priceMinInput: "",
      priceMaxInput: "",
    });
  });

  it("completes a legacy record that predates a filter", () => {
    const legacy = { search: "betta", family: "Osphronemidae" };
    expect(normalizeSearch(legacy)).toMatchObject({
      search: "betta",
      family: "Osphronemidae",
      careLevel: "all",
      fulfillment: "all",
    });
  });

  it("preserves a deliberately empty string rather than replacing it", () => {
    // "" is a real value for a text filter and must not be defaulted away.
    expect(normalizeSearch({ search: "", priceMinInput: "" }).search).toBe("");
  });
});

describe("loadSavedSearches", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(loadSavedSearches(fakeStorage())).toEqual([]);
  });

  it("survives corrupt JSON instead of throwing into a render", () => {
    const storage = fakeStorage({ [SAVED_SEARCHES_KEY]: "{not json" });
    expect(loadSavedSearches(storage)).toEqual([]);
  });

  it("survives a stored value that is not an array", () => {
    const storage = fakeStorage({ [SAVED_SEARCHES_KEY]: '{"nope":true}' });
    expect(loadSavedSearches(storage)).toEqual([]);
  });

  it("returns nothing when storage is unavailable", () => {
    expect(loadSavedSearches(null)).toEqual([]);
  });
});

describe("addSavedSearch", () => {
  it("appends a normalized record with a timestamp", () => {
    const storage = fakeStorage();
    const list = addSavedSearch({ search: "guppy" }, storage);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ search: "guppy", family: "all" });
    expect(list[0].savedAt).toBeTypeOf("number");
  });

  it("de-duplicates an identical filter set instead of piling up", () => {
    const storage = fakeStorage();
    addSavedSearch(FULL, storage);
    const list = addSavedSearch(FULL, storage);
    expect(list, "two clicks on the same filters must not make two rows").toHaveLength(1);
  });

  it("treats a differing filter as a distinct search", () => {
    const storage = fakeStorage();
    addSavedSearch(FULL, storage);
    const list = addSavedSearch({ ...FULL, careLevel: "Advanced" }, storage);
    expect(list).toHaveLength(2);
  });

  it("caps the list, dropping the oldest", () => {
    const storage = fakeStorage();
    for (let i = 0; i < MAX_SAVED_SEARCHES + 5; i++) {
      addSavedSearch({ search: `s${i}` }, storage);
    }
    const list = loadSavedSearches(storage);
    expect(list).toHaveLength(MAX_SAVED_SEARCHES);
    expect(list[list.length - 1].search).toBe(`s${MAX_SAVED_SEARCHES + 4}`);
    expect(list.some((e) => e.search === "s0")).toBe(false);
  });

  it("does not throw when storage rejects the write", () => {
    const throwing = {
      getItem: () => "[]",
      setItem: () => { throw new Error("QuotaExceededError"); },
    };
    expect(() => addSavedSearch({ search: "x" }, throwing)).not.toThrow();
  });
});

describe("removeSavedSearch", () => {
  it("removes by index", () => {
    const storage = withSearches([{ search: "a" }, { search: "b" }, { search: "c" }]);
    const list = removeSavedSearch(1, storage);
    expect(list.map((e) => e.search)).toEqual(["a", "c"]);
  });

  it("ignores an out-of-range index rather than corrupting the list", () => {
    const storage = withSearches([{ search: "a" }]);
    expect(removeSavedSearch(9, storage)).toHaveLength(1);
    expect(removeSavedSearch(-1, storage)).toHaveLength(1);
  });
});

describe("describeSavedSearch", () => {
  it("summarizes a full filter set", () => {
    expect(describeSavedSearch(FULL)).toBe(
      '"guppy" · Poeciliidae · Beginner · shipped · $10–$40'
    );
  });

  it("omits filters left at 'all' rather than listing them as criteria", () => {
    // Labelling an unset filter would make every saved search look identical.
    expect(describeSavedSearch({ search: "betta", family: "all", careLevel: "all" }))
      .toBe('"betta"');
  });

  it("describes an unfiltered search honestly", () => {
    expect(describeSavedSearch({})).toBe("All listings");
  });

  it("handles one-sided price bounds", () => {
    expect(describeSavedSearch({ priceMinInput: "25" })).toBe("from $25");
    expect(describeSavedSearch({ priceMaxInput: "25" })).toBe("up to $25");
  });

  it("is stable enough to serve as the de-duplication identity", () => {
    // addSavedSearch compares descriptions, so equivalent records must describe
    // identically regardless of which optional fields were stored.
    expect(describeSavedSearch({ search: "guppy" })).toBe(
      describeSavedSearch({ search: "guppy", family: "all", fulfillment: "all" })
    );
  });
});
