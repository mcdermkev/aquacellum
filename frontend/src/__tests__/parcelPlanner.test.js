/**
 * Unit tests for the parcel planner (Task 13).
 *
 * Verifies packed-cart → parcel-count planning, rate scaling with parcels, and
 * the add-item parcel delta (the "rate changes when another box is required"
 * signal). Composes packingEngine + shippingSafety-derived profiles.
 *
 * Run with: npx vitest --run src/__tests__/parcelPlanner.test.js
 */

import { describe, it, expect } from "vitest";
import { planParcels, planParcelsForRate, parcelDeltaForItem } from "../services/parcelPlanner.js";
import { normalizeParcelPreset } from "../services/packingEngine.js";
import { normalizeSpeciesProfile } from "../services/shippingSafety.js";

const preset = normalizeParcelPreset({}); // 40oz / 4 bags / 720in3 / thermal 240 / 6 livestock

const smallPeaceful = normalizeSpeciesProfile({
  maxLengthCm: 4,
  tankMetrics: { tempRangeCelsius: [22, 26], phRange: [6, 7], minVolumeGallons: 10 },
  behavior: { temperament: "peaceful" },
});
const aggressive = normalizeSpeciesProfile({
  maxLengthCm: 12,
  tankMetrics: { tempRangeCelsius: [20, 28], phRange: [7, 8], minVolumeGallons: 20 },
  ecology: { socialBehavior: "territorial and aggressive" },
});

describe("planParcels", () => {
  it("fits a small order in a single parcel", () => {
    const plan = planParcels([{ sku: "a", speciesProfile: smallPeaceful, quantity: 2 }], preset);
    expect(plan.parcels).toBe(1);
    expect(plan.perItem[0]).toMatchObject({ sku: "a", separationRequired: false });
  });

  it("reflects separation: aggressive species get one bag each", () => {
    const plan = planParcels([{ sku: "a", speciesProfile: aggressive, quantity: 3 }], preset);
    expect(plan.perItem[0].separationRequired).toBe(true);
    expect(plan.perItem[0].bagCount).toBe(3); // 3 bags (one per fish)
  });

  it("needs a second parcel when bag count exceeds one box's capacity", () => {
    // 5 light bags; a box holds 4 bags → 2 parcels (bag count is the binding
    // constraint here; explicit profile keeps weight/volume well under caps).
    const plan = planParcels([
      { sku: "a", packingProfile: { bagCount: 5, packedWeightOz: 10, volumeIn3: 50, requiresThermalPack: true, livestock: 5 } },
    ], preset);
    expect(plan.parcels).toBe(2);
  });

  it("uses an explicit packing profile when provided", () => {
    const plan = planParcels([
      { sku: "a", packingProfile: { bagCount: 1, packedWeightOz: 50, volumeIn3: 100, requiresThermalPack: true, livestock: 1 } },
    ], preset);
    expect(plan.parcels).toBe(2); // 50oz > 40oz cap → 2 boxes
  });

  it("is deterministic", () => {
    const items = [{ sku: "a", speciesProfile: smallPeaceful, quantity: 2 }];
    expect(planParcels(items, preset)).toEqual(planParcels(items, preset));
  });
});

describe("planParcelsForRate", () => {
  it("scales shipping cost with the parcel count", () => {
    const items = [
      { sku: "a", packingProfile: { bagCount: 5, packedWeightOz: 10, volumeIn3: 50, requiresThermalPack: true, livestock: 5 } },
    ]; // 5 bags / 4 per box → 2 parcels
    const { parcels, shippingCents } = planParcelsForRate(items, preset, 1500);
    expect(parcels).toBe(2);
    expect(shippingCents).toBe(3000);
  });
});

describe("parcelDeltaForItem", () => {
  it("addedParcel is false when the add-on rides along", () => {
    const current = [{ sku: "a", speciesProfile: smallPeaceful, quantity: 1 }];
    const candidate = { sku: "b", speciesProfile: smallPeaceful, quantity: 1 };
    const delta = parcelDeltaForItem(current, candidate, preset);
    expect(delta.addedParcel).toBe(false);
    expect(delta.parcelsBefore).toBe(1);
    expect(delta.parcelsAfter).toBe(1);
  });

  it("addedParcel is true when the add-on forces another box", () => {
    // Current cart already fills a box's 4 bags (light weight); one more bag
    // forces box 2. Explicit profiles isolate bag count as the binding factor.
    const current = [{ sku: "a", packingProfile: { bagCount: 4, packedWeightOz: 8, volumeIn3: 40, requiresThermalPack: true, livestock: 4 } }];
    const candidate = { sku: "b", packingProfile: { bagCount: 1, packedWeightOz: 2, volumeIn3: 10, requiresThermalPack: true, livestock: 1 } };
    const delta = parcelDeltaForItem(current, candidate, preset);
    expect(delta.parcelsBefore).toBe(1);
    expect(delta.parcelsAfter).toBe(2);
    expect(delta.addedParcel).toBe(true);
  });
});
