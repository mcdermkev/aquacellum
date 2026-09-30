/**
 * A species with no recorded diet must stay "no diet" everywhere.
 *
 * The catalog hooks used to backfill a missing trophicLevel with "Omnivore",
 * which then produced an "Easy Feeder" card tag, a "Diet: Omnivore" line in
 * Poseidon's species context, a diet line in listing drafts, and a false
 * "diet known" flag in shipping safety. These tests pin the null path through
 * the shared normalizer and every pure consumer.
 *
 * Run with: npx vitest run src/__tests__/missingDiet.test.js
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { normalizeSpeciesRecord } from "../services/normalizeSpeciesRecord.js";
import {
  DIET_NOT_RECORDED,
  normalizeDiet,
  realDietText,
  isCarnivoreTrophic,
  isHerbivoreTrophic,
  isPlainOmnivore,
} from "../services/speciesDiet.js";
import { casualCardTags } from "../services/speciesCardTags.js";
import { normalizeSpeciesProfile, evaluateCoBagging, evaluateBagGroup } from "../services/shippingSafety.js";
import { buildListingDraftFromSpecies } from "../services/listingDraft.js";
import { speciesMatchesIntent, DISCOVERY_INTENTS } from "../components/finder/discoveryIntents.js";
import { getSpeciesCare } from "../components/logbook/SpeciesCareGuide";
import { formatSpeciesForContext } from "../../api/_lib/speciesIndex.js";

const CATALOG = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../public/fishbase_master.json", import.meta.url)), "utf8")
);

// Shaped like the catalog's no-diet fish (no `diet` key at all).
const NO_DIET_FISH = {
  specCode: 900001,
  scientificName: "Testus nodietus",
  commonName: "No-diet test fish",
  type: "fish",
  family: "Cyprinidae",
  maxLengthCm: 4,
  tankMetrics: { tempRangeCelsius: [22, 26], phRange: [6.5, 7.5], minVolumeGallons: 10 },
  ecology: { socialBehavior: "Peaceful schooling fish" },
};

// Shaped like the six ricefish records: a diet object with null / blank fields.
const BLANK_DIET_FISH = {
  ...NO_DIET_FISH,
  specCode: 900002,
  scientificName: "Testus blankdietus",
  diet: { trophicLevel: null, fooditems: "", feedingPlaybook: "" },
};

// Stale placeholder values an older cache may still hold.
const PLACEHOLDER_DIET_FISH = {
  ...NO_DIET_FISH,
  specCode: 900003,
  scientificName: "Testus placeholderus",
  diet: { trophicLevel: "", fooditems: "Information arriving soon", feedingPlaybook: "Information arriving soon" },
};

const NO_DIET_PLANT = {
  specCode: 900004,
  scientificName: "Plantus testus",
  commonName: "Test plant",
  type: "plant",
};

const REAL_OMNIVORE = {
  ...NO_DIET_FISH,
  specCode: 900005,
  scientificName: "Testus omnivorus",
  diet: { trophicLevel: "Omnivore", fooditems: "Micro-pellets, small live foods", feedingPlaybook: "" },
};

const MISSING = [NO_DIET_FISH, BLANK_DIET_FISH, PLACEHOLDER_DIET_FISH, NO_DIET_PLANT];

describe("normalizeSpeciesRecord (shared by useSpeciesData and useCatalogHydration)", () => {
  it.each(MISSING.map((r) => [r.scientificName, r]))("%s keeps diet null", (_name, record) => {
    const out = normalizeSpeciesRecord(record);
    expect(out.diet).toEqual({ trophicLevel: null, fooditems: null, feedingPlaybook: null });
    expect(JSON.stringify(out.diet)).not.toMatch(/omnivore/i);
    expect(JSON.stringify(out.diet)).not.toMatch(/information arriving soon/i);
  });

  it("keeps a recorded diet as-is", () => {
    const out = normalizeSpeciesRecord(REAL_OMNIVORE);
    expect(out.diet.trophicLevel).toBe("Omnivore");
    expect(out.diet.fooditems).toBe("Micro-pellets, small live foods");
    expect(out.diet.feedingPlaybook).toBeNull();
  });

  it("does not add an Omnivore to any catalog record that lacks a trophic level", () => {
    const rawMissing = CATALOG.filter((s) => !realDietText(s.diet?.trophicLevel));
    const rawOmnivores = CATALOG.filter((s) => s.diet?.trophicLevel === "Omnivore").length;
    const normalized = CATALOG.map(normalizeSpeciesRecord);

    expect(rawMissing.length).toBeGreaterThan(0);
    expect(normalized.filter((s) => s.diet.trophicLevel == null).length).toBe(rawMissing.length);
    expect(normalized.filter((s) => s.diet.trophicLevel === "Omnivore").length).toBe(rawOmnivores);
  });
});

describe("feeding tags", () => {
  it("no diet never earns Easy Feeder", () => {
    for (const record of MISSING) {
      const tags = casualCardTags(normalizeSpeciesRecord(record), { careLevel: 1, isPlant: record.type === "plant" });
      expect(tags).not.toContain("Easy Feeder");
    }
  });

  it("a recorded Omnivore fish still earns Easy Feeder", () => {
    expect(casualCardTags(normalizeSpeciesRecord(REAL_OMNIVORE), { careLevel: 1 })).toContain("Easy Feeder");
  });

  it("plants never get a feeding tag, even with an Omnivore value", () => {
    const plant = { ...NO_DIET_PLANT, diet: { trophicLevel: "Omnivore" } };
    expect(casualCardTags(plant, { careLevel: 1, isPlant: true })).not.toContain("Easy Feeder");
    expect(casualCardTags(plant, { careLevel: 1 })).not.toContain("Easy Feeder");
  });

  it("no plant or no-diet record in the real catalog gets Easy Feeder", () => {
    const offenders = CATALOG.map(normalizeSpeciesRecord).filter((s) => {
      const tags = casualCardTags(s, { careLevel: 1, isPlant: s.type === "plant" });
      return tags.includes("Easy Feeder") && (s.type === "plant" || s.diet.trophicLevel == null);
    });
    expect(offenders).toEqual([]);
  });
});

describe("diet predicates treat null as no match", () => {
  it.each([null, undefined, "", "   ", "Information arriving soon", 42, {}])("%p", (value) => {
    expect(realDietText(value)).toBeNull();
    expect(isPlainOmnivore(value)).toBe(false);
    expect(isCarnivoreTrophic(value)).toBe(false);
    expect(isHerbivoreTrophic(value)).toBe(false);
  });

  it("matches recorded compound labels", () => {
    expect(isCarnivoreTrophic("Carnivore / Piscivore")).toBe(true);
    expect(isHerbivoreTrophic("Herbivore / Detritivore")).toBe(true);
    expect(isPlainOmnivore("Omnivore/Detritivore")).toBe(false);
    expect(isPlainOmnivore("omnivore")).toBe(true);
  });

  it("normalizeDiet tolerates a missing diet object", () => {
    expect(normalizeDiet(undefined)).toEqual({ trophicLevel: null, fooditems: null, feedingPlaybook: null });
    expect(normalizeDiet(null)).toEqual({ trophicLevel: null, fooditems: null, feedingPlaybook: null });
  });

  it("exposes a plain label for filled slots", () => {
    expect(DIET_NOT_RECORDED).toBe("Diet not recorded");
  });
});

describe("filters do not match a missing diet", () => {
  it("the cleanup intent (the only diet-driven Finder filter) excludes a no-diet fish", () => {
    const fishbaseData = [normalizeSpeciesRecord(NO_DIET_FISH), normalizeSpeciesRecord(BLANK_DIET_FISH)];
    for (const rec of fishbaseData) {
      expect(speciesMatchesIntent({ scientificName: rec.scientificName }, "cleanup", { fishbaseData })).toBe(false);
    }
  });

  it("no intent throws on a no-diet record", () => {
    const fishbaseData = MISSING.map(normalizeSpeciesRecord);
    for (const { id } of DISCOVERY_INTENTS) {
      for (const rec of fishbaseData) {
        expect(() => speciesMatchesIntent({ scientificName: rec.scientificName }, id, { fishbaseData })).not.toThrow();
      }
    }
  });
});

describe("shippingSafety with no diet", () => {
  it("normalizes to null trophic level, not a carnivore, diet confidence false", () => {
    for (const record of MISSING) {
      const p = normalizeSpeciesProfile(normalizeSpeciesRecord(record));
      expect(p.trophicLevel).toBeNull();
      expect(p.carnivore).toBe(false);
      expect(p.dataConfidence.diet).toBe(false);
    }
  });

  it("co-bag evaluation does not crash", () => {
    const a = normalizeSpeciesProfile(normalizeSpeciesRecord(NO_DIET_FISH));
    const b = normalizeSpeciesProfile(normalizeSpeciesRecord({ ...BLANK_DIET_FISH, maxLengthCm: 20 }));
    const c = normalizeSpeciesProfile({});
    expect(() => evaluateCoBagging(a, b)).not.toThrow();
    expect(() => evaluateBagGroup([a, b, c])).not.toThrow();
    // No carnivore on record, so a big size gap is a size disparity, not predation.
    const codes = evaluateCoBagging(a, b).reasons.map((r) => r.code);
    expect(codes).not.toContain("predation_risk");
  });

  it("flags a compound Carnivore / Piscivore label as a carnivore", () => {
    const p = normalizeSpeciesProfile({ diet: { trophicLevel: "Carnivore / Piscivore" } });
    expect(p.carnivore).toBe(true);
  });
});

describe("listing drafts, care guide and Poseidon context with no diet", () => {
  it("listing draft carries no diet and marks it unknown", () => {
    for (const record of MISSING) {
      const draft = buildListingDraftFromSpecies(normalizeSpeciesRecord(record));
      expect(draft.care.diet).toBeNull();
      expect(draft.care.dataConfidence.diet).toBe(false);
      expect(draft.groundingFacts.diet).toBeNull();
    }
  });

  it("care guide shows no diet chip", () => {
    const fishbaseData = [normalizeSpeciesRecord({ ...NO_DIET_FISH, speciesId: 900001 })];
    const care = getSpeciesCare({ speciesId: 900001, commonName: NO_DIET_FISH.commonName }, fishbaseData, []);
    expect(care.diet).toBeNull();
  });

  it("Poseidon species context has no Diet line", () => {
    for (const record of MISSING) {
      const text = formatSpeciesForContext(normalizeSpeciesRecord(record));
      expect(text).not.toMatch(/Diet:/);
      expect(text).not.toMatch(/omnivore/i);
    }
  });

  it("Poseidon species context omits the dash when foods are missing", () => {
    const text = formatSpeciesForContext({ ...NO_DIET_FISH, diet: { trophicLevel: "Carnivore", fooditems: "" } });
    expect(text).toMatch(/- Diet: Carnivore$/m);
  });
});
