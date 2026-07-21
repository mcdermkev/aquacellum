/**
 * Unit tests for the packing capacity engine (Task 11, Tier A).
 *
 * Covers weight/bags/volume/thermal/livestock capacity, the additional-box
 * threshold (the signal that shipping rate changes), and separation-driven bag
 * counts derived from temperament.
 *
 * Run with: npx vitest --run src/__tests__/packingEngine.test.js
 */

import { describe, it, expect } from "vitest";
import {
  PACKING_DEFAULTS,
  normalizeParcelPreset,
  deriveDefaultPackingProfile,
  computeUsage,
  remainingCapacity,
  boxesRequired,
  canAddToParcel,
} from "../services/packingEngine.js";
import { normalizeSpeciesProfile } from "../services/shippingSafety.js";

describe("normalizeParcelPreset", () => {
  it("applies defaults for null columns", () => {
    expect(normalizeParcelPreset({})).toMatchObject({
      usableWeightOz: PACKING_DEFAULTS.usableWeightOz,
      maxBags: PACKING_DEFAULTS.maxBags,
      usableVolumeIn3: PACKING_DEFAULTS.usableVolumeIn3,
      maxLivestock: PACKING_DEFAULTS.maxLivestock,
    });
  });

  it("reads seller-provided capacity columns", () => {
    const p = normalizeParcelPreset({ usable_weight_oz: 60, max_bags: 8, usable_volume_in3: 1000, thermal_pack_space_in3: 300, max_livestock: 10 });
    expect(p).toMatchObject({ usableWeightOz: 60, maxBags: 8, usableVolumeIn3: 1000, thermalPackSpaceIn3: 300, maxLivestock: 10 });
  });
});

describe("deriveDefaultPackingProfile", () => {
  it("packs peaceful small fish together (no separation)", () => {
    const neon = normalizeSpeciesProfile({ maxLengthCm: 4, tankMetrics: { tempRangeCelsius: [22, 26], phRange: [6, 7] }, behavior: { temperament: "peaceful" } });
    const profile = deriveDefaultPackingProfile(neon, 4);
    expect(profile.separationRequired).toBe(false);
    expect(profile.bagCount).toBe(1); // 4 small peaceful fish share a bag
    expect(profile.livestock).toBe(4);
  });

  it("gives aggressive fish their own bag each (separation)", () => {
    const convict = normalizeSpeciesProfile({ maxLengthCm: 12, tankMetrics: { tempRangeCelsius: [20, 28], phRange: [7, 8] }, ecology: { socialBehavior: "territorial and aggressive" } });
    const profile = deriveDefaultPackingProfile(convict, 3);
    expect(profile.separationRequired).toBe(true);
    expect(profile.bagCount).toBe(3);
  });

  it("treats unknown temperament conservatively (separation required)", () => {
    const mystery = normalizeSpeciesProfile({ maxLengthCm: 5, tankMetrics: { tempRangeCelsius: [22, 26], phRange: [6.5, 7.5] } });
    expect(deriveDefaultPackingProfile(mystery, 2).separationRequired).toBe(true);
  });
});

describe("computeUsage + remainingCapacity", () => {
  it("sums profiles and reports remaining box capacity", () => {
    const preset = normalizeParcelPreset({}); // 40oz / 4 bags / 720in3 / 6 livestock
    const usage = computeUsage([
      { bagCount: 2, packedWeightOz: 20, volumeIn3: 200, requiresThermalPack: true, livestock: 2 },
    ]);
    expect(usage).toMatchObject({ weightOz: 20, bags: 2, volumeIn3: 200, thermalPacks: 1, livestock: 2 });
    expect(remainingCapacity(preset, usage)).toMatchObject({ weightOz: 20, bags: 2, livestock: 4 });
  });
});

describe("boxesRequired", () => {
  const preset = normalizeParcelPreset({}); // 40oz / 4 bags / 720in3 / thermal 240 / 6 livestock

  it("is zero for an empty order", () => {
    expect(boxesRequired(preset, computeUsage([]))).toBe(0);
  });

  it("is one when everything fits", () => {
    const usage = computeUsage([{ bagCount: 2, packedWeightOz: 20, volumeIn3: 200, requiresThermalPack: true, livestock: 2 }]);
    expect(boxesRequired(preset, usage)).toBe(1);
  });

  it("needs a second box when weight exceeds one box", () => {
    const usage = computeUsage([{ bagCount: 1, packedWeightOz: 50, volumeIn3: 100, livestock: 1 }]);
    expect(boxesRequired(preset, usage)).toBe(2); // 50oz / 40oz cap
  });

  it("needs a second box when the livestock cap is exceeded", () => {
    const usage = computeUsage([{ bagCount: 3, packedWeightOz: 10, volumeIn3: 100, livestock: 7 }]);
    expect(boxesRequired(preset, usage)).toBe(2); // 7 / 6 cap
  });

  it("needs a second box when bag count exceeds capacity", () => {
    const usage = computeUsage([{ bagCount: 5, packedWeightOz: 10, volumeIn3: 100, livestock: 5 }]);
    expect(boxesRequired(preset, usage)).toBe(2); // 5 bags / 4 max
  });
});

describe("canAddToParcel — additional-box threshold", () => {
  const preset = normalizeParcelPreset({});
  const current = [{ bagCount: 2, packedWeightOz: 20, volumeIn3: 200, requiresThermalPack: true, livestock: 2 }];

  it("rides along at no extra box for a small compatible add-on", () => {
    const candidate = { bagCount: 1, packedWeightOz: 10, volumeIn3: 80, requiresThermalPack: true, livestock: 1 };
    const res = canAddToParcel(preset, current, candidate);
    expect(res.boxesBefore).toBe(1);
    expect(res.boxesAfter).toBe(1);
    expect(res.addedBox).toBe(false);
  });

  it("forces a second box (rate change) when the add-on exceeds capacity", () => {
    const candidate = { bagCount: 3, packedWeightOz: 30, volumeIn3: 300, requiresThermalPack: true, livestock: 4 };
    const res = canAddToParcel(preset, current, candidate);
    expect(res.boxesBefore).toBe(1);
    expect(res.boxesAfter).toBe(2);
    expect(res.addedBox).toBe(true);
  });
});
