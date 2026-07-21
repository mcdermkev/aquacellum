/**
 * Unit tests for the add-on recommendation ranker (Task 11, Tier B).
 *
 * Covers the tank-fit safety filter, box-fit preference, stock filtering,
 * seller boost, determinism, separation, and score parity with the legacy
 * `calculateCompatibility` formula (guarding the MarketplaceBoard.jsx /
 * CheckoutSummary.jsx refactor).
 *
 * Run with: npx vitest --run src/__tests__/addOnRecommender.test.js
 */

import { describe, it, expect } from "vitest";
import { evaluateTankFit, recommendAddOns } from "../services/addOnRecommender.js";
import { normalizeParcelPreset, deriveDefaultPackingProfile, canAddToParcel } from "../services/packingEngine.js";
import { normalizeSpeciesProfile } from "../services/shippingSafety.js";

// ─── Legacy formula, preserved here only for the parity test (§6.7) ────────
function legacyCalculateCompatibility(item, displayTank) {
  if (!displayTank) return 0;
  const minVol = item.minVolumeGallons ?? 30;
  const simVolume = Number(displayTank.volume);
  const simPh = Number(displayTank.ph);
  const simTemp = Number(displayTank.temp);

  let pVol = 0;
  if (simVolume < minVol) pVol = ((minVol - simVolume) / minVol) * 100;

  let pPh = 0;
  if (simPh < item.minPh) pPh = ((item.minPh - simPh) / 1.5) * 100;
  else if (simPh > item.maxPh) pPh = ((simPh - item.maxPh) / 1.5) * 100;
  pPh = Math.min(100, pPh);

  let pTemp = 0;
  if (simTemp < item.minTemp) pTemp = ((item.minTemp - simTemp) / 5.0) * 100;
  else if (simTemp > item.maxTemp) pTemp = ((simTemp - item.maxTemp) / 5.0) * 100;
  pTemp = Math.min(100, pTemp);

  const sVol = Math.max(0, 100 - pVol);
  const sPh = Math.max(0, 100 - pPh);
  const sTemp = Math.max(0, 100 - pTemp);

  return Math.round((sVol / 100) * (sPh / 100) * (sTemp / 100) * 100);
}

describe("evaluateTankFit", () => {
  it("returns caution with a zero score when there is no tank", () => {
    const profile = { minVolumeGallons: 20, tempRange: [22, 26], phRange: [6.5, 7.5] };
    expect(evaluateTankFit(profile, null)).toMatchObject({ score: 0, verdict: "caution" });
  });

  it("blocks a species needing 55g in a 20g tank (< 0.5 * min)", () => {
    const profile = { minVolumeGallons: 55, tempRange: [22, 26], phRange: [6.5, 7.5] };
    const result = evaluateTankFit(profile, { volume: 20, temp: 24, ph: 7.0 });
    expect(result.verdict).toBe("blocked");
  });

  it("blocks a lethal temperature mismatch (> 3C outside range)", () => {
    const profile = { minVolumeGallons: 10, tempRange: [22, 26], phRange: [6.5, 7.5] };
    const result = evaluateTankFit(profile, { volume: 40, temp: 30.5, ph: 7.0 }); // 4.5C above max
    expect(result.verdict).toBe("blocked");
  });

  it("blocks a lethal pH mismatch (> 1.0 outside range)", () => {
    const profile = { minVolumeGallons: 10, tempRange: [22, 26], phRange: [6.5, 7.5] };
    const result = evaluateTankFit(profile, { volume: 40, temp: 24, ph: 9.0 }); // 1.5 above max
    expect(result.verdict).toBe("blocked");
  });

  it("never blocks on missing data (unknown minVolume/temp/ph => caution, not blocked)", () => {
    const profileNoVolume = { tempRange: [22, 26], phRange: [6.5, 7.5] };
    expect(evaluateTankFit(profileNoVolume, { volume: 1, temp: 24, ph: 7.0 }).verdict).not.toBe("blocked");

    const profileNoTemp = { minVolumeGallons: 10, phRange: [6.5, 7.5] };
    expect(evaluateTankFit(profileNoTemp, { volume: 40, temp: 100, ph: 7.0 }).verdict).not.toBe("blocked");

    const profileNoPh = { minVolumeGallons: 10, tempRange: [22, 26] };
    expect(evaluateTankFit(profileNoPh, { volume: 40, temp: 24, ph: 14 }).verdict).not.toBe("blocked");

    const emptyProfile = {};
    expect(evaluateTankFit(emptyProfile, { volume: 0, temp: 100, ph: 14 }).verdict).toBe("caution");
  });

  it("verdict is 'ok' at score >= 80 and 'caution' below, when not blocked", () => {
    const profile = { minVolumeGallons: 10, tempRange: [22, 26], phRange: [6.5, 7.5] };
    const good = evaluateTankFit(profile, { volume: 40, temp: 24, ph: 7.0 });
    expect(good.score).toBeGreaterThanOrEqual(80);
    expect(good.verdict).toBe("ok");

    // Mild mismatch: pH slightly out of range but not enough to block.
    const borderline = evaluateTankFit(profile, { volume: 40, temp: 24, ph: 8.2 }); // 0.7 above max, under 1.0 block threshold
    expect(borderline.verdict).toBe("caution");
    expect(borderline.score).toBeLessThan(80);
  });

  it("§6.7 parity: matches the legacy calculateCompatibility score for fixed inputs", () => {
    const cases = [
      { item: { minVolumeGallons: 30, minTemp: 22, maxTemp: 26, minPh: 6.5, maxPh: 7.5 }, tank: { volume: 40, temp: 24, ph: 7.0 } },
      { item: { minVolumeGallons: 30, minTemp: 22, maxTemp: 26, minPh: 6.5, maxPh: 7.5 }, tank: { volume: 10, temp: 30, ph: 8.5 } },
      { item: { minVolumeGallons: 55, minTemp: 24, maxTemp: 28, minPh: 6.0, maxPh: 7.0 }, tank: { volume: 20, temp: 24, ph: 7.0 } },
      { item: { minTemp: 22, maxTemp: 26, minPh: 6.5, maxPh: 7.5 }, tank: { volume: 30, temp: 24, ph: 7.0 } }, // default minVol=30
    ];

    for (const { item, tank } of cases) {
      const legacy = legacyCalculateCompatibility(item, tank);
      const speciesProfile = {
        minVolumeGallons: item.minVolumeGallons,
        tempRange: [item.minTemp, item.maxTemp],
        phRange: [item.minPh, item.maxPh],
      };
      const ported = evaluateTankFit(speciesProfile, tank).score;
      expect(ported).toBe(legacy);
    }
  });
});

// ─── Ranker fixtures ─────────────────────────────────────────────────────────

const preset = normalizeParcelPreset({}); // 40oz / 4 bags / 720in3 / thermal 240 / 6 livestock

const peacefulSmall = normalizeSpeciesProfile({
  maxLengthCm: 4,
  tankMetrics: { tempRangeCelsius: [22, 26], phRange: [6, 7], minVolumeGallons: 10 },
  behavior: { temperament: "peaceful" },
});

const aggressiveLarge = normalizeSpeciesProfile({
  maxLengthCm: 12,
  tankMetrics: { tempRangeCelsius: [20, 28], phRange: [7, 8], minVolumeGallons: 20 },
  ecology: { socialBehavior: "territorial and aggressive" },
});

const buyerTank = { volume: 40, temp: 24, ph: 7.0 };

function baseCtx(overrides = {}) {
  return { preset, cartProfiles: [], buyerTank, ...overrides };
}

describe("recommendAddOns", () => {
  it("1. excludes a species needing 55g in a 20g tank; excludes a lethal temp/pH mismatch; blocks nothing with a null tank", () => {
    const tooBig = normalizeSpeciesProfile({
      maxLengthCm: 30,
      tankMetrics: { tempRangeCelsius: [22, 26], phRange: [6.5, 7.5], minVolumeGallons: 55 },
      behavior: { temperament: "peaceful" },
    });
    const lethalTemp = normalizeSpeciesProfile({
      maxLengthCm: 5,
      tankMetrics: { tempRangeCelsius: [10, 14], phRange: [6.5, 7.5], minVolumeGallons: 10 },
      behavior: { temperament: "peaceful" },
    });

    const candidates = [
      { listingId: "1", speciesProfile: tooBig, quantityAvailable: 5, priceCents: 500 },
      { listingId: "2", speciesProfile: lethalTemp, quantityAvailable: 5, priceCents: 500 },
      { listingId: "3", speciesProfile: peacefulSmall, quantityAvailable: 5, priceCents: 500 },
    ];

    const withTank = recommendAddOns(candidates, baseCtx({ buyerTank: { volume: 20, temp: 24, ph: 7.0 } }));
    expect(withTank.map((r) => r.listingId)).not.toContain("1");

    const withTank2 = recommendAddOns(candidates, baseCtx({ buyerTank: { volume: 40, temp: 24, ph: 7.0 } }));
    expect(withTank2.map((r) => r.listingId)).not.toContain("2");

    const noTank = recommendAddOns(candidates, baseCtx({ buyerTank: null }));
    expect(noTank.map((r) => r.listingId).sort()).toEqual(["1", "2", "3"]);
  });

  it("2. a small add-on that rides along ranks above one that forces a second box, all else equal", () => {
    const ridesAlong = {
      listingId: "rides",
      speciesProfile: peacefulSmall,
      packingProfile: { bagCount: 1, packedWeightOz: 5, volumeIn3: 50, requiresThermalPack: true, livestock: 1 },
      quantityAvailable: 5,
      priceCents: 500,
    };
    const forcesBox = {
      listingId: "forces",
      speciesProfile: peacefulSmall,
      packingProfile: { bagCount: 4, packedWeightOz: 35, volumeIn3: 700, requiresThermalPack: true, livestock: 4 },
      quantityAvailable: 5,
      priceCents: 500,
    };

    const cartProfiles = [{ bagCount: 1, packedWeightOz: 5, volumeIn3: 50, requiresThermalPack: true, livestock: 1 }];
    const ranked = recommendAddOns([forcesBox, ridesAlong], baseCtx({ cartProfiles }));

    expect(ranked.find((r) => r.listingId === "rides").boxFit.addedBox).toBe(false);
    expect(ranked.find((r) => r.listingId === "forces").boxFit.addedBox).toBe(true);
    expect(ranked[0].listingId).toBe("rides");
  });

  it("3. excludes out-of-stock candidates", () => {
    const candidates = [
      { listingId: "in-stock", speciesProfile: peacefulSmall, quantityAvailable: 3, priceCents: 500 },
      { listingId: "out-of-stock", speciesProfile: peacefulSmall, quantityAvailable: 0, priceCents: 500 },
    ];
    const ranked = recommendAddOns(candidates, baseCtx());
    expect(ranked.map((r) => r.listingId)).toEqual(["in-stock"]);
  });

  it("4. a seller boost lifts a boosted candidate above an equivalent unboosted one", () => {
    const candidates = [
      { listingId: "plain", speciesProfile: peacefulSmall, quantityAvailable: 5, priceCents: 500 },
      { listingId: "boosted", speciesProfile: peacefulSmall, quantityAvailable: 5, priceCents: 500, sellerBoost: 1 },
    ];
    const ranked = recommendAddOns(candidates, baseCtx());
    expect(ranked[0].listingId).toBe("boosted");
  });

  it("5. determinism: shuffling candidates yields the same ranked order (tiebreak by listingId)", () => {
    const candidates = [
      { listingId: "3", speciesProfile: peacefulSmall, quantityAvailable: 5, priceCents: 500 },
      { listingId: "1", speciesProfile: peacefulSmall, quantityAvailable: 5, priceCents: 500 },
      { listingId: "2", speciesProfile: peacefulSmall, quantityAvailable: 5, priceCents: 500 },
    ];
    const shuffled = [candidates[2], candidates[0], candidates[1]];

    const rankedA = recommendAddOns(candidates, baseCtx()).map((r) => r.listingId);
    const rankedB = recommendAddOns(shuffled, baseCtx()).map((r) => r.listingId);

    expect(rankedA).toEqual(rankedB);
    expect(rankedA).toEqual(["1", "2", "3"]); // identical scores -> ascending listingId tiebreak
  });

  it("6. an aggressive add-on gets bagCount >= quantity and is not co-bagged", () => {
    const candidates = [
      { listingId: "aggro", speciesProfile: aggressiveLarge, quantityAvailable: 3, priceCents: 500 },
    ];
    const ranked = recommendAddOns(candidates, baseCtx());
    const derivedProfile = deriveDefaultPackingProfile(aggressiveLarge, 1);
    expect(derivedProfile.separationRequired).toBe(true);
    expect(derivedProfile.bagCount).toBeGreaterThanOrEqual(1);

    // canAddToParcel reflects the extra bag usage (not silently co-bagged with cart contents)
    const boxFit = canAddToParcel(preset, [], derivedProfile);
    expect(ranked[0].boxFit.usage.bags).toBe(boxFit.usage.bags);
  });

  it("7. evaluateTankFit parity is covered above; ranker score is deterministic given identical weights", () => {
    const candidates = [{ listingId: "x", speciesProfile: peacefulSmall, quantityAvailable: 5, priceCents: 500 }];
    const first = recommendAddOns(candidates, baseCtx())[0].score;
    const second = recommendAddOns(candidates, baseCtx())[0].score;
    expect(first).toBe(second);
  });

  it("respects custom weights", () => {
    const candidates = [
      { listingId: "cheap", speciesProfile: peacefulSmall, quantityAvailable: 5, priceCents: 100 },
      { listingId: "pricey", speciesProfile: peacefulSmall, quantityAvailable: 5, priceCents: 9000 },
    ];
    const priceOnlyWeights = { boxFit: 0, tankFit: 0, inventory: 0, price: 1, sellerBoost: 0 };
    const ranked = recommendAddOns(candidates, baseCtx({ weights: priceOnlyWeights }));
    expect(ranked[0].listingId).toBe("cheap");
  });
});
