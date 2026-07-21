/**
 * Unit tests for the shipping co-bagging safety engine (Task 11, Tier A).
 *
 * Shipping safety is a hard constraint: these tests pin the block rules and the
 * conservative "missing data → ship individually" behavior.
 *
 * Run with: npx vitest --run src/__tests__/shippingSafety.test.js
 */

import { describe, it, expect } from "vitest";
import {
  TEMPERAMENT,
  COBAG_REASONS,
  classifyTemperament,
  normalizeSpeciesProfile,
  evaluateCoBagging,
  evaluateBagGroup,
} from "../services/shippingSafety.js";

// Realistic fishbase_master-shaped records.
const neon = {
  commonName: "Neon Tetra", scientificName: "Paracheirodon innesi", maxLengthCm: 4,
  tankMetrics: { tempRangeCelsius: [22, 26], phRange: [6, 7] },
  diet: { trophicLevel: "Omnivore" },
  behavior: { temperament: "Peaceful community fish, best in schools" },
};
const ember = {
  commonName: "Ember Tetra", maxLengthCm: 3,
  tankMetrics: { tempRangeCelsius: [23, 27], phRange: [6, 7.5] },
  diet: { trophicLevel: "Omnivore" },
  ecology: { socialBehavior: "Peaceful, gentle, ideal for community tanks" },
};
const convict = {
  commonName: "Convict Cichlid", maxLengthCm: 12.2,
  tankMetrics: { tempRangeCelsius: [20, 28], phRange: [7, 8], minVolumeGallons: 30 },
  diet: { trophicLevel: "Omnivore" },
  ecology: { socialBehavior: "Highly territorial and aggressive, especially when breeding." },
};
const bigCarnivore = {
  commonName: "Oscar", maxLengthCm: 30,
  tankMetrics: { tempRangeCelsius: [22, 28], phRange: [6.5, 7.5] },
  diet: { trophicLevel: "Carnivore" },
  behavior: { temperament: "Peaceful for its size but a natural piscivore" },
};
const bigPeacefulHerbivore = {
  commonName: "Giant Gourami", maxLengthCm: 40,
  tankMetrics: { tempRangeCelsius: [22, 28], phRange: [6.5, 7.5] },
  diet: { trophicLevel: "Herbivore" },
  behavior: { temperament: "Docile and peaceful" },
};
const unknownTemperament = {
  commonName: "Mystery Fish", maxLengthCm: 5,
  tankMetrics: { tempRangeCelsius: [22, 26], phRange: [6.5, 7.5] },
  diet: { trophicLevel: "Omnivore" },
  // no behavior/socialBehavior text
};

const P = (r) => normalizeSpeciesProfile(r);

describe("classifyTemperament", () => {
  it("classifies by keyword with severity precedence", () => {
    expect(classifyTemperament("Highly territorial and aggressive").value).toBe(TEMPERAMENT.AGGRESSIVE);
    expect(classifyTemperament("A natural predator that will eat smaller fish").value).toBe(TEMPERAMENT.PREDATORY);
    expect(classifyTemperament("Territorial, defends its cave").value).toBe(TEMPERAMENT.TERRITORIAL);
    expect(classifyTemperament("Semi-aggressive fin nipper").value).toBe(TEMPERAMENT.SEMI_AGGRESSIVE);
    expect(classifyTemperament("Peaceful community fish").value).toBe(TEMPERAMENT.PEACEFUL);
  });

  it("returns unknown/low confidence for empty or unrecognized text", () => {
    expect(classifyTemperament("")).toEqual({ value: TEMPERAMENT.UNKNOWN, confidence: "low" });
    expect(classifyTemperament("swims a lot").value).toBe(TEMPERAMENT.UNKNOWN);
  });
});

describe("normalizeSpeciesProfile", () => {
  it("extracts structured fields and confidence from a fishbase record", () => {
    const p = P(convict);
    expect(p.adultSizeCm).toBe(12.2);
    expect(p.tempRange).toEqual([20, 28]);
    expect(p.phRange).toEqual([7, 8]);
    expect(p.minVolumeGallons).toBe(30);
    expect(p.carnivore).toBe(false);
    expect(p.temperament.value).toBe(TEMPERAMENT.AGGRESSIVE);
    expect(p.dataConfidence.temperament).toBe(true);
  });

  it("flags low confidence when temperament text is missing", () => {
    const p = P(unknownTemperament);
    expect(p.temperament.value).toBe(TEMPERAMENT.UNKNOWN);
    expect(p.dataConfidence.temperament).toBe(false);
  });
});

describe("evaluateCoBagging", () => {
  it("allows two peaceful, environmentally-compatible, similar-size fish", () => {
    const res = evaluateCoBagging(P(neon), P(ember));
    expect(res.canShareBag).toBe(true);
    expect(res.reasons).toEqual([]);
  });

  it("blocks an aggressive/territorial species from sharing a bag", () => {
    const res = evaluateCoBagging(P(convict), P(neon));
    expect(res.block).toBe(true);
    expect(res.reasons.map((r) => r.code)).toContain(COBAG_REASONS.AGGRESSIVE_CONFINED);
  });

  it("blocks predation risk when a carnivore is much larger than a bagmate", () => {
    const res = evaluateCoBagging(P(bigCarnivore), P(neon));
    expect(res.block).toBe(true);
    expect(res.reasons.map((r) => r.code)).toContain(COBAG_REASONS.PREDATION_RISK);
  });

  it("blocks size disparity even without a carnivore", () => {
    const res = evaluateCoBagging(P(bigPeacefulHerbivore), P(neon));
    expect(res.block).toBe(true);
    expect(res.reasons.map((r) => r.code)).toContain(COBAG_REASONS.SIZE_DISPARITY);
  });

  it("blocks non-overlapping temperature", () => {
    const cold = { commonName: "Coldwater", maxLengthCm: 5, tankMetrics: { tempRangeCelsius: [10, 18], phRange: [6.5, 7.5] }, behavior: { temperament: "peaceful" } };
    const res = evaluateCoBagging(P(cold), P(neon));
    expect(res.reasons.map((r) => r.code)).toContain(COBAG_REASONS.INCOMPATIBLE_TEMPERATURE);
  });

  it("blocks non-overlapping pH", () => {
    const alkaline = { commonName: "Rift Cichlid Peaceful", maxLengthCm: 5, tankMetrics: { tempRangeCelsius: [22, 26], phRange: [8, 9] }, behavior: { temperament: "peaceful" } };
    const res = evaluateCoBagging(P(alkaline), P(neon));
    expect(res.reasons.map((r) => r.code)).toContain(COBAG_REASONS.INCOMPATIBLE_PH);
  });

  it("ships individually when temperament data is incomplete (conservative)", () => {
    const res = evaluateCoBagging(P(unknownTemperament), P(neon));
    expect(res.block).toBe(true);
    expect(res.reasons.map((r) => r.code)).toContain(COBAG_REASONS.INSUFFICIENT_TEMPERAMENT_DATA);
  });

  it("ships individually when environmental data is missing", () => {
    const noEnv = { commonName: "No Params", maxLengthCm: 5, behavior: { temperament: "peaceful" } };
    const res = evaluateCoBagging(P(noEnv), P(neon));
    expect(res.reasons.map((r) => r.code)).toContain(COBAG_REASONS.INSUFFICIENT_ENVIRONMENT_DATA);
  });

  it("is symmetric and deterministic", () => {
    const ab = evaluateCoBagging(P(convict), P(neon));
    const ba = evaluateCoBagging(P(neon), P(convict));
    expect(ab.block).toBe(ba.block);
    expect(ab.reasons.map((r) => r.code).sort()).toEqual(ba.reasons.map((r) => r.code).sort());
  });
});

describe("evaluateBagGroup", () => {
  it("passes a group of compatible peaceful fish", () => {
    const res = evaluateBagGroup([P(neon), P(ember)]);
    expect(res.canShareBag).toBe(true);
    expect(res.conflicts).toEqual([]);
  });

  it("reports the specific conflicting pair by index", () => {
    const res = evaluateBagGroup([P(neon), P(convict), P(ember)]);
    expect(res.canShareBag).toBe(false);
    // convict (index 1) conflicts with both peaceful fish.
    const pairs = res.conflicts.map((c) => `${c.a}-${c.b}`);
    expect(pairs).toContain("0-1");
    expect(pairs).toContain("1-2");
  });
});
