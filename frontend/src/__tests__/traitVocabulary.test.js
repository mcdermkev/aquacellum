/**
 * One list of heritable traits (docs/BREEDER_STATE_MODEL.md §9.13).
 *
 * The vocabulary was written out FOUR times across two components. The failure that
 * makes this worth a module rather than a comment is silent, not loud: a trait added
 * to the wizard's picker but not to its marker state renders a checkbox whose
 * `checked` is `undefined`, so it looks unchecked, ticks when clicked, and is then
 * dropped from `activeMarkers` — the breeder's selection vanishes onto a certificate
 * that outlives the app.
 *
 * So the tests here are mostly about the DERIVED views agreeing with the source, and
 * the source guards are about no copy coming back.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import {
  HERITABLE_TRAITS,
  HERITABLE_TRAIT_IDS,
  INHERITANCE,
  STANDARD_TRAIT,
  TRAIT_PICKER_OPTIONS,
  findHeritableTrait,
  hasNonStandardTrait,
  initialTraitMarkers,
  selectedTraitLabels,
} from "../utils/traitVocabulary";
import { TRAIT_GENETICS } from "../components/GeneticsPrediction";

describe("the source list", () => {
  it("gives every trait everything the calculator needs to compute one", () => {
    // `inheritance` and `symbol` are not decoration — GeneticsPrediction cannot build
    // a Punnett square without them, which is why this list is the source and the
    // label-only copies were the views.
    expect(HERITABLE_TRAITS.length).toBeGreaterThan(0);
    for (const trait of HERITABLE_TRAITS) {
      expect(trait.id, "id").toBeTruthy();
      expect(trait.label, `${trait.id} label`).toBeTruthy();
      expect(trait.pickerLabel, `${trait.id} pickerLabel`).toBeTruthy();
      expect(trait.promptLabel, `${trait.id} promptLabel`).toBeTruthy();
      expect(trait.symbol, `${trait.id} symbol`).toBeTruthy();
      expect(trait.description, `${trait.id} description`).toBeTruthy();
      expect(trait.color, `${trait.id} color`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(Object.values(INHERITANCE), `${trait.id} inheritance`).toContain(trait.inheritance);
    }
  });

  it("has no duplicate ids or symbols", () => {
    expect(new Set(HERITABLE_TRAIT_IDS).size).toBe(HERITABLE_TRAITS.length);
    expect(new Set(HERITABLE_TRAITS.map((t) => t.symbol)).size).toBe(HERITABLE_TRAITS.length);
  });

  it("excludes wildtype, which is the absence of a mutation and has no Punnett square", () => {
    expect(HERITABLE_TRAIT_IDS).not.toContain(STANDARD_TRAIT.id);
    expect(findHeritableTrait(STANDARD_TRAIT.id)).toBeNull();
  });

  it("is frozen, so a consumer cannot mutate the shared vocabulary", () => {
    expect(Object.isFrozen(HERITABLE_TRAITS)).toBe(true);
    expect(Object.isFrozen(HERITABLE_TRAITS[0])).toBe(true);
  });
});

describe("the derived views cannot drift from it", () => {
  it("is the same list the genetics calculator reads", () => {
    // GeneticsPrediction re-exports it under the original name, so this is identity,
    // not equality — there is nothing left to drift.
    expect(TRAIT_GENETICS).toBe(HERITABLE_TRAITS);
  });

  it("offers wildtype plus every heritable trait in the picker, in order", () => {
    expect(TRAIT_PICKER_OPTIONS.map((o) => o.id)).toEqual([
      STANDARD_TRAIT.id,
      ...HERITABLE_TRAIT_IDS,
    ]);
    for (const trait of HERITABLE_TRAITS) {
      const option = TRAIT_PICKER_OPTIONS.find((o) => o.id === trait.id);
      expect(option.label, trait.id).toBe(trait.pickerLabel);
    }
  });

  it("gives the marker state an entry for EVERY picker option — the silent failure", () => {
    // This is the assertion the four copies existed without. A picker option with no
    // state entry gets `checked={undefined}`, which React renders as unchecked, and
    // the selection is then invisible to `activeMarkers`.
    const markers = initialTraitMarkers();
    for (const option of TRAIT_PICKER_OPTIONS) {
      expect(Object.prototype.hasOwnProperty.call(markers, option.id), option.id).toBe(true);
      expect(typeof markers[option.id], option.id).toBe("boolean");
    }
    expect(markers.custom).toBe("");
  });

  it("starts on wildtype with nothing else selected", () => {
    const markers = initialTraitMarkers();
    expect(markers[STANDARD_TRAIT.id]).toBe(true);
    for (const id of HERITABLE_TRAIT_IDS) expect(markers[id], id).toBe(false);
    expect(hasNonStandardTrait(markers)).toBe(false);
  });

  it("returns a FRESH state object each call, since it is React state", () => {
    const a = initialTraitMarkers();
    a.albino = true;
    expect(initialTraitMarkers().albino).toBe(false);
  });
});

describe("hasNonStandardTrait", () => {
  it("is true for any heritable trait, and for a custom entry on its own", () => {
    for (const id of HERITABLE_TRAIT_IDS) {
      expect(hasNonStandardTrait({ ...initialTraitMarkers(), [id]: true }), id).toBe(true);
    }
    expect(hasNonStandardTrait({ ...initialTraitMarkers(), custom: "Blue Diamond" })).toBe(true);
  });

  it("ignores whitespace-only custom text rather than prompting on a stray space", () => {
    expect(hasNonStandardTrait({ ...initialTraitMarkers(), custom: "   " })).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(hasNonStandardTrait(null)).toBe(false);
    expect(hasNonStandardTrait({})).toBe(false);
  });
});

describe("selectedTraitLabels", () => {
  it("reads in vocabulary order regardless of the order they were ticked", () => {
    const markers = { ...initialTraitMarkers(), metallic: true, albino: true };
    expect(selectedTraitLabels(markers)).toEqual(["Albino", "Metallic"]);
  });

  it("appends the custom entry, trimmed, after the known ones", () => {
    const markers = { ...initialTraitMarkers(), longfin: true, custom: "  Blue Diamond  " };
    expect(selectedTraitLabels(markers)).toEqual(["Longfin", "Blue Diamond"]);
  });

  it("returns an empty list rather than a stray separator when nothing is selected", () => {
    // The prompt joins on ", " — a falsy entry surviving into the array would render
    // as a leading comma.
    expect(selectedTraitLabels(initialTraitMarkers())).toEqual([]);
    expect(selectedTraitLabels(null)).toEqual([]);
    expect(selectedTraitLabels(initialTraitMarkers()).join(", ")).toBe("");
  });
});

describe("source guards", () => {
  function code(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  const WIZARD = code("../components/SpawningWizard.jsx");
  const GENETICS = code("../components/GeneticsPrediction.jsx");
  const VOCAB = code("../utils/traitVocabulary.js");

  it("strips comments, or the absences below are vacuous", () => {
    // Both files discuss the copies they removed, by name.
    expect(WIZARD).not.toContain("failed silently");
    expect(GENETICS).not.toContain("written out four times");
    expect(WIZARD).toContain("const PHENOTYPES = TRAIT_PICKER_OPTIONS");
  });

  it("leaves no second copy of the vocabulary in either component", () => {
    for (const [name, src] of [["wizard", WIZARD], ["genetics", GENETICS]]) {
      // A label or an allele symbol appearing here means a copy came back.
      expect(src, `${name}: label`).not.toContain("Amelanistic");
      expect(src, `${name}: label`).not.toContain("Veiltail Mutation");
      expect(src, `${name}: inheritance`).not.toContain('"codominant"');
    }
    // And each reads the shared module instead.
    expect(WIZARD).toContain('from "../utils/traitVocabulary"');
    expect(GENETICS).toContain('from "../utils/traitVocabulary"');
  });

  it("derives the wizard's marker state and prompt rather than listing ids again", () => {
    expect(WIZARD).toContain("useState(initialTraitMarkers)");
    expect(WIZARD).toContain("hasNonStandardTrait(geneticMarkers)");
    expect(WIZARD).toContain("selectedTraitLabels(geneticMarkers)");
    // The old hand-maintained disjunction and label list are gone.
    expect(WIZARD).not.toMatch(/geneticMarkers\.albino\s*\|\|/);
    expect(WIZARD).not.toMatch(/geneticMarkers\.albino && "Albino"/);
  });

  it("keeps the free-text escape hatch, which is the seam to the morph pipeline", () => {
    // §9.13's other half is deliberately NOT built: a submitted morph carries no
    // inheritance model, so feeding it to the calculator would mean guessing one.
    // `custom` is where a breeder's unmodelled trait already goes.
    expect(WIZARD).toContain("geneticMarkers.custom");
    expect(VOCAB).toContain("markers.custom");
  });

  it("does not reach for the morph submissions API, and says why", () => {
    expect(VOCAB).not.toContain("morphSubmissionsApi");
    expect(VOCAB).not.toContain("supabase");
    // The reasoning has to survive in the file, since this is a rejected request
    // rather than an unbuilt one.
    const raw = readFileSync(fileURLToPath(new URL("../utils/traitVocabulary.js", import.meta.url)), "utf8");
    expect(raw).toMatch(/free text/i);
    expect(raw).toMatch(/inheritance/i);
  });
});
