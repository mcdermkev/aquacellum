import { describe, it, expect } from "vitest";
import {
  planProgramLine,
  planBreedingProgram,
  buildSpecimenSpecs,
  emptyProgramLine,
  MAX_FISH_PER_LINE,
  MAX_PROGRAM_FISH,
} from "../utils/breedingProgram";

const GUPPY = { speciesId: 1, commonName: "Guppy", scientificName: "Poecilia reticulata" };
const BETTA = { speciesId: 3, commonName: "Betta", scientificName: "Betta splendens" };
const CATALOG = new Map([
  [1, GUPPY],
  [3, BETTA],
]);

const row = (over = {}) => ({ ...emptyProgramLine(), line: "Blue Grass A1", species: "Guppy", speciesId: 1, ...over });

describe("planProgramLine", () => {
  it("normalizes a valid line and copies catalog names", () => {
    const l = planProgramLine(row({ males: 2, females: 3 }), GUPPY);
    expect(l.errors).toHaveLength(0);
    expect(l.line).toBe("Blue Grass A1");
    expect(l.males).toBe(2);
    expect(l.females).toBe(3);
    expect(l.fishCount).toBe(5);
    expect(l.commonName).toBe("Guppy");
    expect(l.scientificName).toBe("Poecilia reticulata");
  });

  it("errors on a missing line name", () => {
    expect(planProgramLine(row({ line: "  " }), GUPPY).errors).toContain("Missing line name");
  });

  it("errors when the species is unresolved (never guesses)", () => {
    expect(planProgramLine(row({ speciesId: null }), null).errors).toContain("Species not matched");
    expect(planProgramLine(row({ speciesId: "" }), null).errors).toContain("Species not matched");
  });

  it("errors when the line has no fish", () => {
    expect(planProgramLine(row({ males: 0, females: 0, unsexed: 0 }), GUPPY).errors).toContain("No fish in this line");
  });

  it("treats negative or junk counts as zero rather than throwing", () => {
    const l = planProgramLine(row({ males: -4, females: "abc", unsexed: 2 }), GUPPY);
    expect(l.males).toBe(0);
    expect(l.females).toBe(0);
    expect(l.unsexed).toBe(2);
    expect(l.fishCount).toBe(2);
  });

  it("caps a line at MAX_FISH_PER_LINE with a warning, preserving the ratio", () => {
    const l = planProgramLine(row({ males: 100, females: 100, unsexed: 0 }), GUPPY);
    expect(l.fishCount).toBe(MAX_FISH_PER_LINE);
    expect(l.warnings.join(" ")).toMatch(/capped/i);
    // Even split preserved, and no sex silently dropped.
    expect(l.males).toBeGreaterThan(0);
    expect(l.females).toBeGreaterThan(0);
    expect(l.males + l.females + l.unsexed).toBe(MAX_FISH_PER_LINE);
  });

  it("converts tank volume from gallons to liters, defaulting when blank", () => {
    expect(planProgramLine(row({ volumeGal: 20 }), GUPPY).volumeLiters).toBe(Math.round(20 * 3.78541));
    expect(planProgramLine(row({ volumeGal: 0 }), GUPPY).volumeLiters).toBe(Math.round(10 * 3.78541));
  });

  it("NEVER emits a parent pointer (foundation stock rule)", () => {
    const l = planProgramLine(row(), GUPPY);
    expect(l.sireId).toBeUndefined();
    expect(l.damId).toBeUndefined();
  });
});

describe("planBreedingProgram", () => {
  it("produces one tank per ready line, named for the line", () => {
    const plan = planBreedingProgram(
      [row({ line: "A1" }), row({ line: "B2", speciesId: 3 })],
      CATALOG
    );
    expect(plan.readyLines).toHaveLength(2);
    expect(plan.tankSpecs.map((t) => t.name)).toEqual(["A1", "B2"]);
    expect(plan.totalFish).toBe(4); // 1♂+1♀ each
  });

  it("excludes errored rows from tanks, fish, and the total", () => {
    const plan = planBreedingProgram([row({ line: "A1" }), row({ line: "" })], CATALOG);
    expect(plan.readyLines).toHaveLength(1);
    expect(plan.tankSpecs).toHaveLength(1);
    expect(plan.skippedCount).toBe(1);
    expect(plan.totalFish).toBe(2);
  });

  it("flags a program over the total fish cap", () => {
    const many = Array.from({ length: 20 }, (_, i) => row({ line: `L${i}`, males: 10, females: 10 }));
    const plan = planBreedingProgram(many, CATALOG);
    expect(plan.totalFish).toBeGreaterThan(MAX_PROGRAM_FISH);
    expect(plan.overCap).toBe(true);
  });

  it("is not over cap for a normal program", () => {
    const plan = planBreedingProgram([row({ males: 2, females: 4 })], CATALOG);
    expect(plan.overCap).toBe(false);
  });
});

describe("buildSpecimenSpecs", () => {
  it("expands counts into individual fish with the right genders", () => {
    const plan = planBreedingProgram([row({ line: "A1", males: 2, females: 3, unsexed: 1 })], CATALOG);
    const specs = buildSpecimenSpecs(plan.readyLines, [500]);
    expect(specs).toHaveLength(6);
    expect(specs.filter((s) => s.gender === "Male")).toHaveLength(2);
    expect(specs.filter((s) => s.gender === "Female")).toHaveLength(3);
    expect(specs.filter((s) => s.gender === "Unsexed")).toHaveLength(1);
  });

  it("tags every fish in a line with the line name and its tank", () => {
    const plan = planBreedingProgram([row({ line: "Blue Grass A1" })], CATALOG);
    const specs = buildSpecimenSpecs(plan.readyLines, [500]);
    for (const s of specs) {
      expect(s.breederStockTag).toBe("Blue Grass A1");
      expect(s.currentTankId).toBe(500);
      expect(s.speciesId).toBe(1);
      expect(s.commonName).toBe("Guppy");
    }
  });

  it("maps each line onto the tank id at the same index", () => {
    const plan = planBreedingProgram([row({ line: "A1" }), row({ line: "B2", speciesId: 3 })], CATALOG);
    const specs = buildSpecimenSpecs(plan.readyLines, [100, 200]);
    expect(specs.filter((s) => s.breederStockTag === "A1").every((s) => s.currentTankId === 100)).toBe(true);
    expect(specs.filter((s) => s.breederStockTag === "B2").every((s) => s.currentTankId === 200)).toBe(true);
  });

  it("leaves a fish unassigned rather than filing it into another line's tank", () => {
    const plan = planBreedingProgram([row({ line: "A1" }), row({ line: "B2", speciesId: 3 })], CATALOG);
    const specs = buildSpecimenSpecs(plan.readyLines, [100]); // second tank id missing
    expect(specs.filter((s) => s.breederStockTag === "B2").every((s) => s.currentTankId === 0)).toBe(true);
  });

  it("emits no parent pointers on any fish (foundation stock rule)", () => {
    const plan = planBreedingProgram([row({ males: 3, females: 3 })], CATALOG);
    const specs = buildSpecimenSpecs(plan.readyLines, [1]);
    expect(specs).toHaveLength(6);
    for (const s of specs) {
      expect(s.sireId).toBeUndefined();
      expect(s.damId).toBeUndefined();
    }
  });

  it("returns nothing for an empty program", () => {
    expect(buildSpecimenSpecs([], [])).toHaveLength(0);
  });
});
