/**
 * Unit tests for the local-delivery safety-eligibility engine (Task 12, Tier A).
 *
 * Verifies the hard safety blockers route to a pickup fallback, timing issues
 * route to reschedule, the thermal-pack temperature widening, and cautions.
 *
 * Run with: npx vitest --run src/__tests__/deliveryEligibility.test.js
 */

import { describe, it, expect } from "vitest";
import {
  DELIVERY_VERDICT,
  DELIVERY_BLOCKERS,
  DELIVERY_TIMING,
  MAX_LIVESTOCK_TRANSIT_MINUTES,
  evaluateDeliveryEligibility,
} from "../services/deliveryEligibility.js";

// A safe, dispatchable baseline; tests override one field at a time.
function baseCtx(overrides = {}) {
  return {
    seller: { radiusMiles: 25, prepLeadTimeMinutes: 60 },
    distanceMiles: 10,
    etaMinutes: 30,
    provider: { maxTravelMinutes: 60, allowsLivestock: true },
    packaging: { sealed: true, insulated: true, leakProof: true, thermalPack: true },
    conditions: { originTempF: 70, destTempF: 72 },
    ...overrides,
  };
}

const codes = (arr) => arr.map((x) => x.code);

describe("happy path", () => {
  it("is eligible when everything is safe", () => {
    const r = evaluateDeliveryEligibility(baseCtx());
    expect(r.verdict).toBe(DELIVERY_VERDICT.ELIGIBLE);
    expect(r.eligibleNow).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.recommendedFallback).toBeNull();
  });
});

describe("hard blockers → pickup fallback", () => {
  it("out of delivery radius", () => {
    const r = evaluateDeliveryEligibility(baseCtx({ distanceMiles: 40 }));
    expect(r.verdict).toBe(DELIVERY_VERDICT.PICKUP_FALLBACK);
    expect(r.recommendedFallback).toBe("pickup");
    expect(codes(r.blockers)).toContain(DELIVERY_BLOCKERS.OUT_OF_RADIUS);
  });

  it("transit exceeds the live-animal limit", () => {
    const r = evaluateDeliveryEligibility(baseCtx({ etaMinutes: MAX_LIVESTOCK_TRANSIT_MINUTES + 10, provider: { maxTravelMinutes: 999, allowsLivestock: true } }));
    expect(codes(r.blockers)).toContain(DELIVERY_BLOCKERS.TRANSIT_TOO_LONG);
    expect(r.verdict).toBe(DELIVERY_VERDICT.PICKUP_FALLBACK);
  });

  it("exceeds the provider's max travel", () => {
    const r = evaluateDeliveryEligibility(baseCtx({ etaMinutes: 50, provider: { maxTravelMinutes: 40, allowsLivestock: true } }));
    expect(codes(r.blockers)).toContain(DELIVERY_BLOCKERS.PROVIDER_MAX_TRAVEL);
  });

  it("provider prohibits livestock", () => {
    const r = evaluateDeliveryEligibility(baseCtx({ provider: { maxTravelMinutes: 60, allowsLivestock: false } }));
    expect(codes(r.blockers)).toContain(DELIVERY_BLOCKERS.PROVIDER_PROHIBITS_LIVESTOCK);
  });

  it("inadequate packaging", () => {
    const r = evaluateDeliveryEligibility(baseCtx({ packaging: { sealed: true, insulated: true, leakProof: false } }));
    expect(codes(r.blockers)).toContain(DELIVERY_BLOCKERS.INADEQUATE_PACKAGING);
  });

  it("unsafe temperature without a thermal pack", () => {
    const r = evaluateDeliveryEligibility(baseCtx({
      packaging: { sealed: true, insulated: true, leakProof: true, thermalPack: false },
      conditions: { originTempF: 70, destTempF: 96 },
    }));
    expect(codes(r.blockers)).toContain(DELIVERY_BLOCKERS.UNSAFE_TEMPERATURE);
  });

  it("a thermal pack widens the safe temperature band", () => {
    const r = evaluateDeliveryEligibility(baseCtx({
      packaging: { sealed: true, insulated: true, leakProof: true, thermalPack: true },
      conditions: { originTempF: 70, destTempF: 96 }, // within 33–102 with the pack
    }));
    expect(codes(r.blockers)).not.toContain(DELIVERY_BLOCKERS.UNSAFE_TEMPERATURE);
    expect(r.verdict).toBe(DELIVERY_VERDICT.ELIGIBLE);
  });
});

describe("timing issues → reschedule", () => {
  it("insufficient prep lead time", () => {
    const now = Date.now();
    const r = evaluateDeliveryEligibility(baseCtx({ window: { startAt: now + 10 * 60000, now } }));
    expect(r.verdict).toBe(DELIVERY_VERDICT.RESCHEDULE);
    expect(codes(r.timingIssues)).toContain(DELIVERY_TIMING.INSUFFICIENT_PREP_LEAD);
    expect(r.eligibleNow).toBe(false);
  });

  it("outside the seller's operating hours", () => {
    const startAt = new Date(2026, 6, 20, 14, 0, 0); // 2pm local
    const day = startAt.getDay();
    const r = evaluateDeliveryEligibility(baseCtx({
      seller: { radiusMiles: 25, prepLeadTimeMinutes: 0, operatingHours: { [day]: [{ open: "09:00", close: "12:00" }] } },
      window: { startAt: startAt.getTime(), now: startAt.getTime() - 3 * 3600000 },
    }));
    expect(codes(r.timingIssues)).toContain(DELIVERY_TIMING.OUTSIDE_OPERATING_HOURS);
    expect(r.verdict).toBe(DELIVERY_VERDICT.RESCHEDULE);
  });

  it("a blocker outranks a timing issue (pickup fallback wins)", () => {
    const now = Date.now();
    const r = evaluateDeliveryEligibility(baseCtx({ distanceMiles: 40, window: { startAt: now + 10 * 60000, now } }));
    expect(r.verdict).toBe(DELIVERY_VERDICT.PICKUP_FALLBACK);
  });
});

describe("cautions", () => {
  it("flags large specimens but stays eligible", () => {
    const r = evaluateDeliveryEligibility(baseCtx({ speciesProfiles: [{ adultSizeCm: 40, commonName: "Oscar" }] }));
    expect(r.verdict).toBe(DELIVERY_VERDICT.ELIGIBLE);
    expect(codes(r.cautions)).toContain("large_specimen");
  });
});

describe("determinism", () => {
  it("returns identical results for identical input", () => {
    expect(evaluateDeliveryEligibility(baseCtx())).toEqual(evaluateDeliveryEligibility(baseCtx()));
  });
});
