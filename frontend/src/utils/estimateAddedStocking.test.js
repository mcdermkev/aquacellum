import { describe, it, expect } from "vitest";
import { estimateAddedStocking } from "./stockingGuidance.js";

// fishbase-style records carrying adult size (maxLengthCm).
const NEON = { speciesId: 1, commonName: "Neon Tetra", maxLengthCm: 3 };
const ANGEL = { speciesId: 2, commonName: "Angelfish", maxLengthCm: 15 };
const fb = [NEON, ANGEL];

const specimen = (speciesId, commonName) => ({ speciesId, commonName, status: 0 });

// ~40 US gallons → 151.4 L; guideline capacity = 40 * 2.54 = 101.6 cm.
const tank40 = (specimens) => ({ id: 1, volumeLiters: 151.4, specimens });

describe("estimateAddedStocking", () => {
  it("raises the percentage when adding a species with a known adult size", () => {
    const tank = tank40([specimen(1, "Neon Tetra")]); // 3cm vs 101.6cm capacity ≈ 3%
    const result = estimateAddedStocking(tank, { speciesId: 1, commonName: "Neon Tetra" }, { fishbaseData: fb });
    expect(result.canEstimate).toBe(true);
    expect(result.afterPercent).toBeGreaterThan(result.beforePercent);
    expect(result.deltaPercent).toBeGreaterThan(0);
  });

  it("computes the exact before/after percentages", () => {
    // Before: empty tank → 0%. After: one Neon (3cm) vs 101.6cm capacity ≈ 3%.
    const tank = tank40([]);
    const result = estimateAddedStocking(tank, { speciesId: 1, commonName: "Neon Tetra" }, { fishbaseData: fb });
    expect(result.beforePercent).toBe(0);
    expect(result.afterPercent).toBe(3); // round(3/101.6*100) = 3
    expect(result.deltaPercent).toBe(3);
  });

  it("reports canEstimate:false when the species being added has an unknown adult size", () => {
    const tank = tank40([specimen(1, "Neon Tetra")]);
    const result = estimateAddedStocking(tank, { speciesId: 999, commonName: "Mystery Fish" }, { fishbaseData: fb });
    expect(result.canEstimate).toBe(false);
    expect(result.beforePercent).toBeNull();
    expect(result.afterPercent).toBeNull();
    expect(result.deltaPercent).toBeNull();
  });

  it("handles a tank with no specimens gracefully", () => {
    const tank = tank40([]);
    const result = estimateAddedStocking(tank, { speciesId: 1, commonName: "Neon Tetra" }, { fishbaseData: fb });
    expect(result.canEstimate).toBe(true);
    expect(result.beforePercent).toBe(0);
    expect(result.afterPercent).toBeGreaterThan(0);
  });

  it("handles an absent/null tank gracefully (no crash, cannot estimate)", () => {
    const result = estimateAddedStocking(null, { speciesId: 1, commonName: "Neon Tetra" }, { fishbaseData: fb });
    // volumeGallons is 0 for a null tank → assessStocking's ratio stays null → cannot estimate.
    expect(result.canEstimate).toBe(false);
  });

  it("handles a tank record with no volumeLiters gracefully", () => {
    const tank = { id: 2, specimens: [] };
    const result = estimateAddedStocking(tank, { speciesId: 1, commonName: "Neon Tetra" }, { fishbaseData: fb });
    expect(result.canEstimate).toBe(false);
  });

  it("does not mutate the original tank's specimens array", () => {
    const specimens = [specimen(1, "Neon Tetra")];
    const tank = tank40(specimens);
    estimateAddedStocking(tank, { speciesId: 2, commonName: "Angelfish" }, { fishbaseData: fb });
    expect(specimens.length).toBe(1);
    expect(tank.specimens.length).toBe(1);
  });

  it("raises the delta more for a larger species than a smaller one", () => {
    const tank = tank40([]);
    const withNeon = estimateAddedStocking(tank, { speciesId: 1, commonName: "Neon Tetra" }, { fishbaseData: fb });
    const withAngel = estimateAddedStocking(tank, { speciesId: 2, commonName: "Angelfish" }, { fishbaseData: fb });
    expect(withAngel.deltaPercent).toBeGreaterThan(withNeon.deltaPercent);
  });
});
