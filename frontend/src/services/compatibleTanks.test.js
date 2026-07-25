import { describe, it, expect } from "vitest";
import {
  tankFitInputs,
  deriveSpeciesProfile,
  profileHasCareData,
  rankCompatibleTanks,
} from "./compatibleTanks.js";
import { evaluateTankFit } from "./addOnRecommender.js";

// A species record in the on-chain-style shape (minTemp/maxTemp/minPh/maxPh).
const NEON = {
  speciesId: 10,
  commonName: "Neon Tetra",
  minTemp: 20, maxTemp: 26,
  minPh: 6.0, maxPh: 7.0,
  tankMetrics: { minVolumeGallons: 10 },
};

const tank = (id, name, liters, tempX10, phX10) => ({
  id, name, volumeLiters: liters,
  latestLog: tempX10 == null ? undefined : { tempCelsiusX10: tempX10, phX10 },
});

describe("tankFitInputs", () => {
  it("converts liters to gallons and reads scaled temp/pH", () => {
    const inputs = tankFitInputs(tank(1, "A", 189.27, 240, 68)); // ~50 gal, 24°C, 6.8
    expect(inputs.volume).toBe(50);
    expect(inputs.temp).toBe(24);
    expect(inputs.ph).toBe(6.8);
  });

  it("leaves temp/pH undefined when there's no log (non-blocking downstream)", () => {
    const inputs = tankFitInputs(tank(1, "A", 100));
    expect(inputs.temp).toBeUndefined();
    expect(inputs.ph).toBeUndefined();
    expect(inputs.volume).toBeGreaterThan(0);
  });
});

describe("deriveSpeciesProfile", () => {
  it("normalizes a matched contract record into the scorer's shape", () => {
    const p = deriveSpeciesProfile({ speciesId: 10, commonName: "Neon Tetra" }, [], [NEON]);
    expect(p.tempRange).toEqual([20, 26]);
    expect(p.phRange).toEqual([6.0, 7.0]);
    expect(p.minVolumeGallons).toBe(10);
    expect(profileHasCareData(p)).toBe(true);
  });

  it("returns a low-confidence profile when the species is unknown", () => {
    const p = deriveSpeciesProfile({ commonName: "Mystery Fish" }, [], []);
    expect(profileHasCareData(p)).toBe(false);
  });
});

describe("rankCompatibleTanks", () => {
  const profile = deriveSpeciesProfile({ speciesId: 10, commonName: "Neon Tetra" }, [], [NEON]);
  const tanks = [
    tank(1, "Nano 2G", 7.6, 240, 68),      // ~2 gal — below half the 10 gal min → blocked
    tank(2, "Community 40G", 151, 240, 68), // ~40 gal, in range → ok
    tank(3, "Cool 40G", 151, 150, 68),      // ~40 gal but 15°C, >3 outside → blocked
  ];

  it("orders ok before caution before blocked", () => {
    const ranked = rankCompatibleTanks(profile, tanks);
    expect(ranked[0].tank.id).toBe(2);
    expect(ranked[0].verdict).toBe("ok");
    expect(ranked[ranked.length - 1].verdict).toBe("blocked");
  });

  it("verdicts match evaluateTankFit for the same inputs (composition, not a fork)", () => {
    const ranked = rankCompatibleTanks(profile, tanks);
    for (const r of ranked) {
      const direct = evaluateTankFit(profile, tankFitInputs(r.tank));
      expect(r.verdict).toBe(direct.verdict);
      expect(r.score).toBe(direct.score);
    }
  });

  it("never blocks when species data is unknown (caution at worst)", () => {
    const unknown = deriveSpeciesProfile({ commonName: "Mystery Fish" }, [], []);
    const ranked = rankCompatibleTanks(unknown, tanks);
    expect(ranked.every((r) => r.verdict !== "blocked")).toBe(true);
  });
});
