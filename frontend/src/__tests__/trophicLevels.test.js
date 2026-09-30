// @vitest-environment node
/**
 * diet.trophicLevel vs FishBase.
 *
 * An old seed script wrote "Omnivore" whenever its source lacked a trophic
 * level. scripts/verify-trophic-levels.mjs compares every FishBase fish with
 * the local FishBase dump: an exact "Omnivore" that FishBase clearly
 * contradicts gets the FishBase label, a provable seed default with no FishBase
 * data becomes null, and every changed record carries diet.trophicSource.
 * These tests pin the classification on fixtures and the invariants on the
 * committed catalog.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import {
  planTrophicLevels,
  fishbaseVerdict,
  catalogClass,
  trophClass,
  dietTextSaysOmnivore,
  loadFishBase,
  loadSeedDefaults,
  LABELS,
} from "../../../scripts/verify-trophic-levels.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const TEXT = read("../../public/fishbase_master.json");
const CATALOG = JSON.parse(TEXT);

const ANIMALS = "mainly animals (troph. 2.8 and up)";
const MIXED = "plants/detritus+animals (troph. 2.2-2.79)";
const PLANTS = "mainly plants/detritus (troph. 2-2.19)";
const eco = (fields) => ({ ecology: { SpecCode: 1, ...fields }, estimate: null, dietRows: 0, foodRows: 0 });
const MODEL_ONLY = { ecology: null, estimate: { Troph: 3.2, seTroph: 0.4, TrophObserved: 0 }, dietRows: 0, foodRows: 0 };

const fish = (specCode, fishbaseSpecCode, trophicLevel, extra = {}) => ({
  specCode,
  fishbaseSpecCode,
  scientificName: `Testus species${specCode}`,
  diet: { trophicLevel, fooditems: "Small invertebrates", feedingPlaybook: "", ...extra },
});

describe("FishBase verdict", () => {
  it("maps troph numbers with the Herbivory2 cut-offs", () => {
    expect(trophClass(2.0)).toBe("herbivore");
    expect(trophClass(2.19)).toBe("herbivore");
    expect(trophClass(2.2)).toBe("omnivore");
    expect(trophClass(2.79)).toBe("omnivore");
    expect(trophClass(2.8)).toBe("carnivore");
    expect(trophClass(null)).toBeNull();
  });

  it("maps the catalog vocabulary", () => {
    expect(catalogClass("Omnivore")).toBe("omnivore");
    expect(catalogClass("Carnivore / Piscivore")).toBe("carnivore");
    expect(catalogClass("Herbivore / Detritivore")).toBe("herbivore");
    expect(catalogClass("Photosynthetic")).toBeNull();
  });

  it("is clear only with two agreeing signals, one decisive", () => {
    expect(fishbaseVerdict(eco({ Herbivory2: ANIMALS, FeedingType: "hunting macrofauna (predator)" }), 1))
      .toMatchObject({ status: "clear", cls: "carnivore" });
    expect(fishbaseVerdict(eco({ Herbivory2: PLANTS, FoodTroph: 2.0, FoodSeTroph: 0 }), 1))
      .toMatchObject({ status: "clear", cls: "herbivore" });
    // One signal alone is not enough.
    expect(fishbaseVerdict(eco({ Herbivory2: ANIMALS }), 1).status).toBe("weak");
  });

  it("treats disagreeing signals as a conflict; 'variable' and tentative troph can veto", () => {
    expect(fishbaseVerdict(eco({ Herbivory2: ANIMALS, FeedingType: "variable", FoodTroph: 3.2 }), 1).status).toBe("conflict");
    expect(fishbaseVerdict(eco({ Herbivory2: MIXED, FoodTroph: 3.4, FoodRemark: "Tentative trophic level derived from 1 + troph of a single food item" }), 1).status).toBe("conflict");
    // A tentative troph cannot decide on its own.
    expect(fishbaseVerdict(eco({ FoodTroph: 3.4, FoodRemark: "Tentative trophic level derived from 1 + troph of a single food item", FeedingType: "variable" }), 1).status).toBe("conflict");
  });

  it("a model estimate from relatives is not species data", () => {
    expect(fishbaseVerdict(MODEL_ONLY, 1)).toMatchObject({ status: "none", model: "3.20 (s.e. 0.40)" });
    expect(fishbaseVerdict(undefined, 1).status).toBe("none");
    expect(fishbaseVerdict({ ...MODEL_ONLY, foodRows: 2 }, 1).status).toBe("weak");
  });

  it("the templated playbook sentence is not evidence of omnivory", () => {
    expect(dietTextSaysOmnivore({ fooditems: "Insects", feedingPlaybook: "Omnivorous and generally unfussy. Offer flakes." })).toBe(false);
    expect(dietTextSaysOmnivore({ fooditems: "Corydoras spp. are foraging omnivores" })).toBe(true);
  });
});

describe("planTrophicLevels on fixtures", () => {
  const FB = new Map([
    [11, eco({ Herbivory2: ANIMALS, FeedingType: "hunting macrofauna (predator)", FoodTroph: 3.2, FoodSeTroph: 0.4 })],
    [12, eco({ Herbivory2: MIXED, FoodTroph: 2.5 })],
    [13, eco({ Herbivory2: ANIMALS, FeedingType: "variable", FoodTroph: 3.1 })],
    [14, eco({ Herbivory2: PLANTS, FeedingType: "grazing on aquatic plants" })],
    [15, MODEL_ONLY],
    [16, eco({ Herbivory2: MIXED, FeedingType: "variable" })],
    [17, eco({ Herbivory2: ANIMALS, FoodTroph: 3.3 })],
  ]);
  const SEED = new Set([105, 106, 107]);
  const CORAL = { specCode: 11, scientificName: "Coralus testus", type: "coral", diet: { trophicLevel: "Omnivore" } };
  const FIXTURES = [
    fish(101, 11, "Omnivore"), // FishBase carnivore -> change
    fish(102, 12, "Omnivore"), // agrees
    fish(103, 13, "Omnivore"), // conflict -> unverified
    fish(104, 14, "Omnivore"), // FishBase herbivore -> change
    fish(105, 15, "Omnivore"), // seed default, no FishBase data -> null
    fish(106, 15, "Omnivore", { fooditems: "Omnivore feeding on insects and algae" }), // own text says omnivore -> keep
    { ...fish(107, 15, "Omnivore"), scientificName: "Pangio kuhlii" }, // hand-set -> keep
    fish(108, 15, "Omnivore"), // no seed evidence -> keep
    fish(109, 16, "Herbivore / Detritivore"), // FishBase omnivore -> report only
    { ...fish(110, 17, "Omnivore"), scientificName: "Symphysodon aequifasciatus" }, // curated -> report only
    fish(111, 11, "Omnivore/Detritivore"), // not exactly Omnivore -> report only
    CORAL, // no fishbaseSpecCode -> never touched
  ];
  let plan;
  beforeAll(() => { plan = planTrophicLevels(FIXTURES, FB, SEED); });
  const kind = (code) => plan.rows.find((r) => r.specCode === code)?.kind;
  const out = (code) => plan.next.find((r) => r.specCode === code);

  it("classifies each case", () => {
    expect(kind(101)).toBe("changed");
    expect(kind(102)).toBe("agree");
    expect(kind(103)).toBe("unverified-conflict");
    expect(kind(104)).toBe("changed");
    expect(kind(105)).toBe("removed");
    expect(kind(106)).toBe("unverified-none");
    expect(kind(107)).toBe("unverified-none");
    expect(kind(108)).toBe("unverified-none");
    expect(kind(109)).toBe("disagree");
    expect(kind(110)).toBe("disagree-curated");
    expect(kind(111)).toBe("disagree");
    expect(plan.rows.some((r) => r.name === "Coralus testus")).toBe(false);
  });

  it("writes the FishBase label and its source", () => {
    expect(out(101).diet.trophicLevel).toBe("Carnivore");
    expect(out(101).diet.trophicSource).toMatch(/^FishBase SpecCode 11: Herbivory2 mainly animals/);
    expect(out(104).diet.trophicLevel).toBe("Herbivore / Detritivore");
    expect(Object.keys(out(101).diet)).toEqual(["trophicLevel", "trophicSource", "fooditems", "feedingPlaybook"]);
    expect(out(105).diet.trophicLevel).toBeNull();
    expect(out(105).diet.trophicSource).toMatch(/^Removed seed default "Omnivore"/);
  });

  it("drops the stock 'Omnivorous' playbook sentence once the label is no longer Omnivore", () => {
    const rec = fish(120, 11, "Omnivore", { feedingPlaybook: "Omnivorous and generally unfussy. Offer flakes daily." });
    const p = planTrophicLevels([rec], FB, SEED);
    expect(p.next[0].diet.trophicLevel).toBe("Carnivore");
    expect(p.next[0].diet.feedingPlaybook).toBe("Offer flakes daily.");
    const kept = fish(121, 12, "Omnivore", { feedingPlaybook: "Omnivorous and generally unfussy. Offer flakes daily." });
    expect(planTrophicLevels([kept], FB, SEED).next[0]).toBe(kept);
  });

  it("the committed catalog has no stock Omnivore sentence on a non-Omnivore FishBase fish", () => {
    for (const r of CATALOG) {
      if (r.diet?.trophicSource && r.diet.trophicLevel !== "Omnivore") {
        expect(String(r.diet.feedingPlaybook || "")).not.toContain("Omnivorous and generally unfussy.");
      }
    }
  });

  it("leaves every other record as the same object", () => {
    const changed = new Set([101, 104, 105]);
    FIXTURES.forEach((rec, i) => {
      if (rec.fishbaseSpecCode != null && changed.has(rec.specCode)) return;
      expect(plan.next[i]).toBe(rec);
    });
  });

  it("a second run changes nothing", () => {
    const again = planTrophicLevels(plan.next, FB, SEED);
    expect(again.next).toEqual(plan.next);
    expect(again.rows.filter((r) => r.kind === "changed" || r.kind === "removed")).toEqual([]);
  });
});

describe("committed catalog", () => {
  it("mirrors are byte-identical", () => {
    expect(read("../../fishbase_master.json")).toBe(TEXT);
  });

  it("only FishBase fish carry a trophicSource, and every one is well formed", () => {
    const sourced = CATALOG.filter((r) => r.diet && "trophicSource" in r.diet);
    expect(sourced.length).toBeGreaterThan(0);
    for (const r of sourced) {
      expect(r.fishbaseSpecCode, `${r.specCode} ${r.scientificName}`).not.toBeNull();
      expect(r.fishbaseSpecCode, `${r.specCode} ${r.scientificName}`).toBeDefined();
      const src = r.diet.trophicSource;
      if (r.diet.trophicLevel == null) {
        expect(src).toMatch(new RegExp(`^Removed seed default "Omnivore" .*FishBase SpecCode ${r.fishbaseSpecCode} has no feeding data$`));
      } else {
        expect(src.startsWith(`FishBase SpecCode ${r.fishbaseSpecCode}: `), `${r.specCode} ${src}`).toBe(true);
        expect([LABELS.carnivore, LABELS.herbivore]).toContain(r.diet.trophicLevel);
      }
    }
  });

  it("no record without fishbaseSpecCode has a changed trophic level", () => {
    const nonFishBase = CATALOG.filter((r) => r.fishbaseSpecCode == null);
    expect(nonFishBase.length).toBeGreaterThan(0);
    for (const r of nonFishBase) expect(r.diet?.trophicSource, `${r.specCode} ${r.scientificName}`).toBeUndefined();
  });

  it("every null trophicLevel with a trophicSource was a FishBase fish, not a coral/invert/plant", () => {
    for (const r of CATALOG) {
      if (r.diet?.trophicSource && r.diet.trophicLevel == null) {
        expect(["plant", "invertebrate", "coral", "amphibian"]).not.toContain(r.type);
      }
    }
  });

  it("re-running the script against the FishBase dump changes nothing", async () => {
    const codes = new Set(CATALOG.filter((r) => r.fishbaseSpecCode != null).map((r) => Number(r.fishbaseSpecCode)));
    const fishbase = await loadFishBase(codes);
    const seed = loadSeedDefaults() || new Set();
    const { next, rows } = planTrophicLevels(CATALOG, fishbase, seed);
    expect(rows.filter((r) => r.kind === "changed" || r.kind === "removed").map((r) => `${r.specCode} ${r.name}`)).toEqual([]);
    expect(JSON.stringify(next, null, 2)).toBe(TEXT);
    // Every FishBase-sourced label still matches FishBase's clear verdict.
    for (const r of CATALOG) {
      if (!r.diet?.trophicSource || r.diet.trophicLevel == null) continue;
      const v = fishbaseVerdict(fishbase.get(Number(r.fishbaseSpecCode)), Number(r.fishbaseSpecCode));
      expect(v.status).toBe("clear");
      expect(LABELS[v.cls]).toBe(r.diet.trophicLevel);
      expect(v.source).toBe(r.diet.trophicSource);
    }
  }, 120000);
});
