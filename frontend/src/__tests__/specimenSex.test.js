/**
 * Canonical sex vocabulary + the single pairing rule
 * (docs/BREEDER_TOOLS_T1_PAIRING_SPEC.md §2.1, acceptance criteria 1–6, 15).
 *
 * The load-bearing test in this file is "does not block a pairing when sex is
 * unknown". Most aquarium species can't be reliably sexed by eye and nearly
 * every existing record is "Unsexed", so a well-meaning filter to male × female
 * would make the Spawning wizard unusable on real data — the failure mode is a
 * breeder who cannot record a spawn that actually happened.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { containsProhibitedTerm } from "../services/orderCopy";
import {
  SEX,
  SEX_OPTIONS,
  PAIRING_COPY,
  PAIRING_SEVERITY,
  allPairingCopy,
  canPair,
  isKnownSex,
  normalizeSex,
  pairingCandidateComparator,
  sexLabel,
  sexOptionLabel,
  sexSymbol,
} from "../utils/specimenSex";

describe("normalizeSex", () => {
  it("passes through the three canonical values", () => {
    expect(normalizeSex("Male")).toBe(SEX.MALE);
    expect(normalizeSex("Female")).toBe(SEX.FEMALE);
    expect(normalizeSex("Unsexed")).toBe(SEX.UNSEXED);
  });

  it("maps the legacy 'Not Sure' value TankList used to write", () => {
    expect(normalizeSex("Not Sure")).toBe(SEX.UNSEXED);
    expect(normalizeSex("not sure")).toBe(SEX.UNSEXED);
  });

  it("maps missing and empty values to Unsexed", () => {
    expect(normalizeSex(null)).toBe(SEX.UNSEXED);
    expect(normalizeSex(undefined)).toBe(SEX.UNSEXED);
    expect(normalizeSex("")).toBe(SEX.UNSEXED);
    expect(normalizeSex("   ")).toBe(SEX.UNSEXED);
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(normalizeSex("male")).toBe(SEX.MALE);
    expect(normalizeSex("  FEMALE  ")).toBe(SEX.FEMALE);
    expect(normalizeSex("M")).toBe(SEX.MALE);
    expect(normalizeSex("f")).toBe(SEX.FEMALE);
  });

  it("fails to Unsexed rather than guessing a sex", () => {
    for (const junk of ["nonsense", "unknown", "?", "-", 42, {}, []]) {
      expect(normalizeSex(junk)).toBe(SEX.UNSEXED);
    }
  });
});

describe("labels and symbols", () => {
  it("renders nothing for an unknown sex instead of a misleading placeholder", () => {
    expect(sexSymbol("Unsexed")).toBe("");
    expect(sexSymbol("Not Sure")).toBe("");
    expect(sexSymbol(null)).toBe("");
    expect(sexSymbol("Male")).toBe("♂");
    expect(sexSymbol("Female")).toBe("♀");
  });

  it("keeps 'Not sure yet' as a casual LABEL only, never a stored value", () => {
    expect(sexLabel(SEX.UNSEXED, { casual: true })).toBe("Not sure yet");
    expect(sexLabel(SEX.UNSEXED)).toBe("Unsexed");
    // The stored vocabulary has exactly three values and none of them is "Not Sure".
    expect(Object.values(SEX)).toEqual(["Male", "Female", "Unsexed"]);
    expect(Object.values(SEX)).not.toContain("Not Sure");
  });

  it("isKnownSex is true only for a recorded sex", () => {
    expect(isKnownSex("Male")).toBe(true);
    expect(isKnownSex("Female")).toBe(true);
    expect(isKnownSex("Unsexed")).toBe(false);
    expect(isKnownSex("Not Sure")).toBe(false);
    expect(isKnownSex(undefined)).toBe(false);
  });

  it("exposes ordered form options covering every stored value", () => {
    expect(SEX_OPTIONS.map((o) => o.value)).toEqual([SEX.MALE, SEX.FEMALE, SEX.UNSEXED]);
    for (const option of SEX_OPTIONS) {
      expect(sexOptionLabel(option)).toBeTruthy();
      expect(sexOptionLabel(option, { casual: true })).toBeTruthy();
    }
    expect(sexOptionLabel(null)).toBe("");
  });
});

describe("canPair — the single pairing rule", () => {
  it("allows a male × female pairing with no warning", () => {
    for (const [a, b] of [["Male", "Female"], ["Female", "Male"]]) {
      const res = canPair(a, b);
      expect(res.ok).toBe(true);
      expect(res.severity).toBe(PAIRING_SEVERITY.NONE);
    }
  });

  it("BLOCKS a known same-sex pairing — the one hard stop", () => {
    const males = canPair("Male", "Male");
    expect(males.ok).toBe(false);
    expect(males.severity).toBe(PAIRING_SEVERITY.ERROR);
    expect(males.reason).toContain("male");

    const females = canPair("Female", "Female");
    expect(females.ok).toBe(false);
    expect(females.severity).toBe(PAIRING_SEVERITY.ERROR);
  });

  it("DOES NOT block a pairing when either sex is unknown", () => {
    // The regression that would make the wizard unusable on real data.
    const cases = [
      ["Male", "Unsexed"],
      ["Unsexed", "Male"],
      ["Female", "Unsexed"],
      ["Unsexed", "Female"],
      ["Unsexed", "Unsexed"],
      ["Not Sure", "Not Sure"],
      [null, undefined],
    ];
    for (const [a, b] of cases) {
      const res = canPair(a, b);
      expect(res.ok, `canPair(${a}, ${b})`).toBe(true);
      expect(res.severity).toBe(PAIRING_SEVERITY.NOTICE);
      expect(res.reason).toBeTruthy();
    }
  });

  it("distinguishes one-unknown from both-unknown so the notice is accurate", () => {
    expect(canPair("Male", "Unsexed").reason).toBe(PAIRING_COPY.oneUnsexed.pro);
    expect(canPair("Unsexed", "Unsexed").reason).toBe(PAIRING_COPY.bothUnsexed.pro);
  });

  it("treats legacy 'Not Sure' identically to 'Unsexed'", () => {
    expect(canPair("Male", "Not Sure")).toEqual(canPair("Male", "Unsexed"));
  });

  it("returns casual copy when asked", () => {
    expect(canPair("Male", "Male", { casual: true }).reason).toBe(PAIRING_COPY.sameSexMale.casual);
    expect(canPair("Male", "Female", { casual: true }).reason).toBe(PAIRING_COPY.compatible.casual);
  });
});

describe("pairingCandidateComparator — order, never filter", () => {
  const fish = [
    { id: 3, gender: "Male" },
    { id: 1, gender: "Unsexed" },
    { id: 2, gender: "Female" },
    { id: 4, gender: "Male" },
  ];

  it("puts the complementary sex first, unsexed next, same-sex last — keeping ALL of them", () => {
    const sorted = [...fish].sort(pairingCandidateComparator("Male"));
    expect(sorted.map((f) => f.id)).toEqual([2, 1, 3, 4]);
    // Nothing was dropped: same-sex candidates are demoted, not removed.
    expect(sorted).toHaveLength(fish.length);
  });

  it("with no counterpart selected, only demotes unsexed", () => {
    const sorted = [...fish].sort(pairingCandidateComparator(null));
    expect(sorted[sorted.length - 1].id).toBe(1);
    expect(sorted).toHaveLength(fish.length);
  });

  it("is stable by serial within a rank", () => {
    const sorted = [...fish].sort(pairingCandidateComparator("Female"));
    expect(sorted.map((f) => f.id)).toEqual([3, 4, 1, 2]);
  });
});

describe("the 'Not Sure' fork is closed at the source", () => {
  // Acceptance criteria 2–3: the legacy value may survive as casual *display*
  // copy inside specimenSex.js, but no component may write it or compare
  // against it. Comments are stripped so a historical note doesn't fail this.
  const FILES = [
    "../components/TankList.jsx",
    "../components/FryNursery.jsx",
    "../components/logbook/TankInhabitants.jsx",
    "../components/MintSpecimen.jsx",
    "../components/SpawningWizard.jsx",
    "../utils/nurseryGrouping.js",
    "../utils/ownedSpecimens.js",
  ];

  function code(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("no component writes or compares the literal 'Not Sure'", () => {
    for (const file of FILES) {
      expect(code(file), file).not.toContain('"Not Sure"');
      expect(code(file), file).not.toContain("'Not Sure'");
    }
  });

  it("the sex pickers seed and reset to the canonical unknown", () => {
    const tankList = code("../components/TankList.jsx");
    expect(tankList).toContain("useState(SEX.UNSEXED)");
    expect(tankList).toContain("SEX_OPTIONS.map");
  });

  it("the Register form collects sex and passes it through normalized", () => {
    const mint = code("../components/MintSpecimen.jsx");
    expect(mint).toContain("SEX_OPTIONS.map");
    expect(mint).toContain("gender: normalizeSex(formData.gender)");
  });

  it("readers use the shared predicates instead of double-checking two spellings", () => {
    for (const file of ["../components/FryNursery.jsx", "../components/logbook/TankInhabitants.jsx"]) {
      expect(code(file), file).toContain("isKnownSex");
      expect(code(file), file).toContain("sexSymbol");
    }
    expect(code("../utils/nurseryGrouping.js")).toContain("normalizeSex(f.gender)");
  });
});

describe("PAIRING_COPY — Web2 language invariant", () => {
  it("every string is free of PROHIBITED_TERMS in both modes", () => {
    for (const text of allPairingCopy()) {
      expect(containsProhibitedTerm(text), `string: "${text}"`).toBe(false);
    }
  });

  it("every entry has both a pro and a casual variant", () => {
    for (const [key, entry] of Object.entries(PAIRING_COPY)) {
      expect(entry.pro, `${key}.pro`).toBeTruthy();
      expect(entry.casual, `${key}.casual`).toBeTruthy();
    }
  });

  it("casual copy avoids the pro-only 'specimen' vocabulary", () => {
    for (const entry of Object.values(PAIRING_COPY)) {
      expect(entry.casual.toLowerCase()).not.toContain("specimen");
    }
  });
});
