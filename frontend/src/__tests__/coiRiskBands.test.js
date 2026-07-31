/**
 * COI risk bands (docs/BREEDER_STATE_MODEL.md §9.18).
 *
 * THE BUG: every band edge was off by a tier. The code used `<=` at each threshold, so
 * a COI landed in the tier BELOW the relationship it actually represents:
 *
 *   6.25 (first cousins)              → "low",      copy: "generally acceptable"
 *   12.5 (half siblings)              → "moderate", copy: "first-cousin mating"
 *   25   (FULL siblings / parent×off) → "high",     copy: "half-sibling mating"
 *
 * The 25% case is the one that mattered. A full-sibling pairing is the single most
 * important warning this feature produces, and it was labelled one tier low AND
 * described as something less severe. The number was right and the words were wrong,
 * which is worse than either alone: the sentence is what a breeder reads.
 *
 * §10.1 makes the relatedness check REQUIRED precisely so an inbreeding warning is
 * never withheld. Understating one is that failure with extra steps.
 *
 * Every edge is pinned here because the original defect was that no test covered them.
 */
import { describe, it, expect } from "vitest";
import { COI_BANDS, COI_RISK_CONFIG, calculateCOIFromMaps } from "../utils/coiCalculator";

/**
 * Build the two ancestor maps `calculateCOIFromMaps` expects, sharing `shared`
 * ancestors at the given generation on each side.
 *
 * Contribution per shared ancestor is (1/2)^(sireGen + damGen + 1), so:
 *   gen 1 each, 1 ancestor → 12.5%  (half siblings)
 *   gen 1 each, 2 ancestors → 25%   (full siblings)
 *   gen 2 each, 2 ancestors → 6.25% (first cousins)
 *   gen 2 each, 1 ancestor → 3.125% (half cousins)
 */
function maps({ sharedIds, generation }) {
  const sire = new Map();
  const dam = new Map();
  for (const id of sharedIds) {
    sire.set(id, { generation, name: `A${id}` });
    dam.set(id, { generation, name: `A${id}` });
  }
  return [sire, dam];
}

const coiFor = (sharedIds, generation) => calculateCOIFromMaps(...maps({ sharedIds, generation }));

describe("the canonical relationships land in the tier that describes them", () => {
  it("full siblings — 25% — are CRITICAL, not high", () => {
    // The headline fix. Two shared parents at generation 1.
    const result = coiFor([1, 2], 1);
    expect(result.coi).toBe(COI_BANDS.FULL_SIBLING);
    expect(result.riskLevel).toBe("critical");
    expect(result.recommendation.toLowerCase()).toContain("full-sibling");
    // And it must no longer describe itself as a lesser relationship.
    expect(result.recommendation.toLowerCase()).not.toMatch(/equivalent to half-sibling/);
  });

  it("half siblings — 12.5% — are HIGH, not moderate", () => {
    const result = coiFor([1], 1);
    expect(result.coi).toBe(COI_BANDS.HALF_SIBLING);
    expect(result.riskLevel).toBe("high");
    expect(result.recommendation.toLowerCase()).toContain("half-sibling");
    expect(result.recommendation.toLowerCase()).not.toContain("first-cousin");
  });

  it("first cousins — 6.25% — are MODERATE, not low", () => {
    const result = coiFor([1, 2], 2);
    expect(result.coi).toBe(COI_BANDS.FIRST_COUSIN);
    expect(result.riskLevel).toBe("moderate");
    expect(result.recommendation.toLowerCase()).toContain("first-cousin");
    // "generally acceptable" was the old copy at this value and is now reserved for
    // pairings more distant than first cousins.
    expect(result.recommendation.toLowerCase()).not.toContain("generally acceptable");
  });

  it("half cousins — 3.125% — remain LOW", () => {
    const result = coiFor([1], 2);
    expect(result.coi).toBeCloseTo(3.13, 2);
    expect(result.riskLevel).toBe("low");
    expect(result.recommendation.toLowerCase()).toContain("more distant than first cousins");
  });

  it("no shared ancestors is OUTBRED, and says so without hedging", () => {
    const result = calculateCOIFromMaps(new Map(), new Map());
    expect(result.coi).toBe(0);
    expect(result.riskLevel).toBe("none");
    expect(result.sharedAncestors).toEqual([]);
  });
});

describe("the band edges are inclusive at the bottom of each tier", () => {
  it("each threshold belongs to the HIGHER tier", () => {
    // This is the whole §9.18 fix expressed as one property: a value exactly equal to
    // a named coefficient is that relationship, so it belongs to that relationship's
    // tier — never the one below.
    expect(coiFor([1, 2], 2).riskLevel).toBe("moderate"); // exactly 6.25
    expect(coiFor([1], 1).riskLevel).toBe("high"); // exactly 12.5
    expect(coiFor([1, 2], 1).riskLevel).toBe("critical"); // exactly 25
  });

  it("exposes the thresholds so callers don't re-declare them", () => {
    expect(COI_BANDS.FIRST_COUSIN).toBe(6.25);
    expect(COI_BANDS.HALF_SIBLING).toBe(12.5);
    expect(COI_BANDS.FULL_SIBLING).toBe(25);
  });

  it("hits the edges exactly, which is what lets the comparisons skip an epsilon", () => {
    // `coiPercent` is rounded to two decimals before banding
    // (Math.round(coi * 10000) / 100). Remove that and these need tolerances.
    expect(coiFor([1, 2], 1).coi).toBe(25);
    expect(coiFor([1], 1).coi).toBe(12.5);
    expect(coiFor([1, 2], 2).coi).toBe(6.25);
  });

  it("treats anything above full-sibling level as critical too", () => {
    // Compounded line-breeding can exceed 25%.
    const result = coiFor([1, 2, 3, 4], 1);
    expect(result.coi).toBeGreaterThan(COI_BANDS.FULL_SIBLING);
    expect(result.riskLevel).toBe("critical");
  });
});

describe("every tier the bands can produce has display config", () => {
  it("has an entry for each risk level, so none renders unstyled", () => {
    for (const level of ["unknown", "none", "low", "moderate", "high", "critical"]) {
      expect(COI_RISK_CONFIG[level], level).toBeTruthy();
      expect(COI_RISK_CONFIG[level].label, level).toBeTruthy();
      expect(COI_RISK_CONFIG[level].color, level).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
