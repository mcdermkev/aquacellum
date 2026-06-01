import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getPersonality } from "./personality.js";

const MODES = ["casual", "pro"];

// ---------------------------------------------------------------------------
// Unit tests — specific examples and edge cases
// ---------------------------------------------------------------------------

describe("getPersonality — unit", () => {
  const fullProfile = {
    personality: {
      vibeLine: { casual: "Tiny tank tornado.", pro: "High-energy nano schooler." },
      flavorText: {
        casual: "Loves a planted tank and a tight school.",
        pro: "Paracheirodon innesi; keep in groups of 10+ for stable behavior.",
      },
    },
  };

  it("returns the exact strings for a well-formed casual request", () => {
    expect(getPersonality(fullProfile, "casual")).toEqual({
      vibeLine: "Tiny tank tornado.",
      flavorText: "Loves a planted tank and a tight school.",
    });
  });

  it("returns the exact strings for a well-formed pro request", () => {
    expect(getPersonality(fullProfile, "pro")).toEqual({
      vibeLine: "High-energy nano schooler.",
      flavorText: "Paracheirodon innesi; keep in groups of 10+ for stable behavior.",
    });
  });

  it("does not throw and returns undefined leaves for null profile", () => {
    expect(getPersonality(null, "casual")).toEqual({
      vibeLine: undefined,
      flavorText: undefined,
    });
  });

  it("does not throw and returns undefined leaves for undefined profile", () => {
    expect(getPersonality(undefined, "pro")).toEqual({
      vibeLine: undefined,
      flavorText: undefined,
    });
  });

  it("handles a profile with no personality block", () => {
    expect(getPersonality({ commonName: "Guppy" }, "casual")).toEqual({
      vibeLine: undefined,
      flavorText: undefined,
    });
  });

  it("handles a missing sub-object (vibeLine present, flavorText absent)", () => {
    const profile = { personality: { vibeLine: { casual: "Hi there." } } };
    expect(getPersonality(profile, "casual")).toEqual({
      vibeLine: "Hi there.",
      flavorText: undefined,
    });
  });

  it("treats empty-string leaves as absent", () => {
    const profile = {
      personality: { vibeLine: { casual: "" }, flavorText: { casual: "ok" } },
    };
    expect(getPersonality(profile, "casual")).toEqual({
      vibeLine: undefined,
      flavorText: "ok",
    });
  });

  it("treats whitespace-only leaves as absent", () => {
    const profile = {
      personality: { vibeLine: { casual: "   \t\n" }, flavorText: { casual: "ok" } },
    };
    expect(getPersonality(profile, "casual")).toEqual({
      vibeLine: undefined,
      flavorText: "ok",
    });
  });

  it("treats non-string leaves as absent (number, object, array, boolean)", () => {
    const profile = {
      personality: {
        vibeLine: { casual: 42, pro: { nested: true } },
        flavorText: { casual: ["arr"], pro: false },
      },
    };
    expect(getPersonality(profile, "casual")).toEqual({
      vibeLine: undefined,
      flavorText: undefined,
    });
    expect(getPersonality(profile, "pro")).toEqual({
      vibeLine: undefined,
      flavorText: undefined,
    });
  });

  it("returns undefined leaves for an invalid mode without throwing", () => {
    expect(getPersonality(fullProfile, "banana")).toEqual({
      vibeLine: undefined,
      flavorText: undefined,
    });
  });

  it("returns undefined leaves for a missing mode argument without throwing", () => {
    expect(getPersonality(fullProfile)).toEqual({
      vibeLine: undefined,
      flavorText: undefined,
    });
  });

  it("preserves a value's internal/leading/trailing characters (returns original, not trimmed)", () => {
    const profile = {
      personality: { vibeLine: { casual: "  spaced out  " } },
    };
    // Non-empty after trim, so it is returned — but returned verbatim.
    expect(getPersonality(profile, "casual").vibeLine).toBe("  spaced out  ");
  });
});

// ---------------------------------------------------------------------------
// Property-based tests
// ---------------------------------------------------------------------------

// Arbitrary "anything", including the awkward values that often break accessors.
const anyValue = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.array(fc.string()),
  fc.object(),
);

// A deliberately garbled "profile": personality may be missing, the wrong type,
// or have sub-objects of arbitrary shape.
const arbitraryProfile = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  anyValue,
  fc.record(
    {
      personality: fc.oneof(
        anyValue,
        fc.record(
          {
            vibeLine: fc.oneof(anyValue, fc.dictionary(fc.string(), anyValue)),
            flavorText: fc.oneof(anyValue, fc.dictionary(fc.string(), anyValue)),
          },
          { requiredKeys: [] },
        ),
      ),
    },
    { requiredKeys: [] },
  ),
);

const arbitraryMode = fc.oneof(
  fc.constantFrom("casual", "pro"),
  fc.string(),
  fc.constant(undefined),
  fc.constant(null),
  fc.integer(),
);

describe("getPersonality — properties", () => {
  // Validates: Property 2 (No crash on partial data)
  it("never throws and always returns an object with exactly vibeLine + flavorText keys", () => {
    fc.assert(
      fc.property(arbitraryProfile, arbitraryMode, (profile, mode) => {
        const result = getPersonality(profile, mode);
        expect(result).toBeTypeOf("object");
        expect(result).not.toBeNull();
        expect(Object.keys(result).sort()).toEqual(["flavorText", "vibeLine"]);
        // Each leaf is either undefined or a non-empty string.
        for (const leaf of [result.vibeLine, result.flavorText]) {
          if (leaf !== undefined) {
            expect(typeof leaf).toBe("string");
            expect(leaf.trim().length).toBeGreaterThan(0);
          }
        }
      }),
    );
  });

  // Validates: Property 1 (Absent = silent) — empty/whitespace strings => undefined
  it("maps empty or whitespace-only leaves to undefined", () => {
    const blank = fc.stringMatching(/^[ \t\n\r]*$/); // only whitespace (incl. empty)
    fc.assert(
      fc.property(fc.constantFrom(...MODES), blank, blank, (mode, vibe, flavor) => {
        const profile = {
          personality: {
            vibeLine: { [mode]: vibe },
            flavorText: { [mode]: flavor },
          },
        };
        const result = getPersonality(profile, mode);
        expect(result.vibeLine).toBeUndefined();
        expect(result.flavorText).toBeUndefined();
      }),
    );
  });

  // Validates: Property 3 (Mode isolation) — reading one mode never returns the other's value
  it("never cross-contaminates casual and pro values", () => {
    const nonEmpty = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);
    fc.assert(
      fc.property(
        nonEmpty,
        nonEmpty,
        nonEmpty,
        nonEmpty,
        (casualVibe, proVibe, casualFlavor, proFlavor) => {
          // Skip degenerate cases where the two modes share an identical string,
          // since then "isolation" is unobservable.
          fc.pre(casualVibe !== proVibe && casualFlavor !== proFlavor);

          const profile = {
            personality: {
              vibeLine: { casual: casualVibe, pro: proVibe },
              flavorText: { casual: casualFlavor, pro: proFlavor },
            },
          };

          const casual = getPersonality(profile, "casual");
          expect(casual.vibeLine).toBe(casualVibe);
          expect(casual.flavorText).toBe(casualFlavor);
          expect(casual.vibeLine).not.toBe(proVibe);
          expect(casual.flavorText).not.toBe(proFlavor);

          const pro = getPersonality(profile, "pro");
          expect(pro.vibeLine).toBe(proVibe);
          expect(pro.flavorText).toBe(proFlavor);
          expect(pro.vibeLine).not.toBe(casualVibe);
          expect(pro.flavorText).not.toBe(casualFlavor);
        },
      ),
    );
  });

  // Validates: Property 3 + well-formed retrieval — exact-string round trip
  it("returns the exact stored string for well-formed, non-empty leaves", () => {
    const nonEmpty = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);
    fc.assert(
      fc.property(fc.constantFrom(...MODES), nonEmpty, nonEmpty, (mode, vibe, flavor) => {
        const profile = {
          personality: {
            vibeLine: { [mode]: vibe },
            flavorText: { [mode]: flavor },
          },
        };
        const result = getPersonality(profile, mode);
        expect(result.vibeLine).toBe(vibe);
        expect(result.flavorText).toBe(flavor);
      }),
    );
  });
});
