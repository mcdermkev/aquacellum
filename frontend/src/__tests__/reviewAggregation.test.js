/**
 * Unit tests for the pure review-aggregation module (Task 20 §3/§6.6).
 *
 * Run with: npx vitest --run src/__tests__/reviewAggregation.test.js
 */

import { describe, it, expect } from "vitest";
import {
  aggregateReviews,
  reputationSummary,
  NEW_SELLER_REVIEW_FLOOR,
  REPUTATION_TONE,
} from "../services/reviewAggregation.js";

function review(overrides = {}) {
  return {
    overall: 5,
    health: 5,
    accuracy: 5,
    packaging: 5,
    communication: 5,
    fulfillment: 5,
    status: "published",
    ...overrides,
  };
}

// ─── §6.6 Aggregation ────────────────────────────────────────────────────────

describe("aggregateReviews — count/average/distribution (§6.6)", () => {
  it("computes count and average across a mixed set of ratings", () => {
    const reviews = [review({ overall: 5 }), review({ overall: 4 }), review({ overall: 3 })];
    const agg = aggregateReviews(reviews);
    expect(agg.count).toBe(3);
    expect(agg.average).toBe(4);
  });

  it("rounds the average to one decimal place", () => {
    const reviews = [review({ overall: 5 }), review({ overall: 5 }), review({ overall: 4 })];
    const agg = aggregateReviews(reviews);
    expect(agg.average).toBeCloseTo(4.7, 5);
  });

  it("builds the 1-5 star distribution correctly", () => {
    const reviews = [
      review({ overall: 5 }),
      review({ overall: 5 }),
      review({ overall: 4 }),
      review({ overall: 1 }),
    ];
    const agg = aggregateReviews(reviews);
    expect(agg.distribution).toEqual({ 5: 2, 4: 1, 3: 0, 2: 0, 1: 1 });
  });

  it("computes per-dimension averages independently", () => {
    const reviews = [
      review({ overall: 5, health: 5, packaging: 3 }),
      review({ overall: 4, health: 3, packaging: 5 }),
    ];
    const agg = aggregateReviews(reviews);
    expect(agg.dimensionAverages.health).toBe(4);
    expect(agg.dimensionAverages.packaging).toBe(4);
  });

  it("a dimension with no ratings anywhere is null, not zero (never fabricated)", () => {
    const reviews = [review({ packaging: undefined }), review({ packaging: undefined })];
    const agg = aggregateReviews(reviews);
    expect(agg.dimensionAverages.packaging).toBeNull();
  });

  it("a dimension applies its average only over reviews that actually rated it (pickup omits packaging)", () => {
    const reviews = [
      review({ packaging: undefined }), // pickup order — no packaging rating
      review({ packaging: 2 }), // shipping order — rated packaging poorly
    ];
    const agg = aggregateReviews(reviews);
    expect(agg.dimensionAverages.packaging).toBe(2); // averaged over the 1 review that rated it, not 2
  });

  it("ignores hidden reviews entirely", () => {
    const reviews = [review({ overall: 5, status: "published" }), review({ overall: 1, status: "hidden" })];
    const agg = aggregateReviews(reviews);
    expect(agg.count).toBe(1);
    expect(agg.average).toBe(5);
  });

  it("ignores flagged reviews entirely", () => {
    const reviews = [review({ overall: 5, status: "published" }), review({ overall: 1, status: "flagged" })];
    const agg = aggregateReviews(reviews);
    expect(agg.count).toBe(1);
    expect(agg.average).toBe(5);
  });

  it("treats a missing status as published (default)", () => {
    const reviews = [review({ overall: 5, status: undefined })];
    const agg = aggregateReviews(reviews);
    expect(agg.count).toBe(1);
  });

  it("returns a zeroed aggregate for an empty review list without throwing", () => {
    const agg = aggregateReviews([]);
    expect(agg.count).toBe(0);
    expect(agg.average).toBe(0);
    expect(agg.distribution).toEqual({ 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });
    expect(Object.values(agg.dimensionAverages).every((v) => v === null)).toBe(true);
  });

  it("no throw when called with undefined/malformed input", () => {
    expect(() => aggregateReviews()).not.toThrow();
    expect(() => aggregateReviews(undefined)).not.toThrow();
    expect(() => aggregateReviews([{}, { overall: "not-a-number" }])).not.toThrow();
  });

  it("is deterministic for identical inputs", () => {
    const reviews = [review({ overall: 5 }), review({ overall: 3 })];
    expect(aggregateReviews(reviews)).toEqual(aggregateReviews(reviews));
  });

  it("ignores an out-of-range overall value (not 1-5) rather than corrupting the average", () => {
    const reviews = [review({ overall: 5 }), review({ overall: 0 }), review({ overall: 6 })];
    const agg = aggregateReviews(reviews);
    expect(agg.count).toBe(1);
    expect(agg.average).toBe(5);
  });
});

// ─── reputationSummary — "New seller" floor ─────────────────────────────────

describe("reputationSummary — New seller floor (§6.6)", () => {
  it(`labels a seller with fewer than ${NEW_SELLER_REVIEW_FLOOR} reviews "New seller", regardless of average`, () => {
    const agg = { count: NEW_SELLER_REVIEW_FLOOR - 1, average: 5 };
    const summary = reputationSummary(agg);
    expect(summary.label).toBe("New seller");
    expect(summary.tone).toBe(REPUTATION_TONE.NEW);
  });

  it("never shows a fake perfect rating for a single 5-star review", () => {
    const summary = reputationSummary({ count: 1, average: 5 });
    expect(summary.label).toBe("New seller");
  });

  it("labels a well-established high average 'Highly rated'", () => {
    const summary = reputationSummary({ count: 20, average: 4.8 });
    expect(summary.label).toBe("Highly rated");
    expect(summary.tone).toBe(REPUTATION_TONE.GOOD);
  });

  it("labels a solid but not exceptional average 'Well reviewed'", () => {
    const summary = reputationSummary({ count: 10, average: 4.0 });
    expect(summary.label).toBe("Well reviewed");
  });

  it("labels a mediocre average 'Mixed reviews'", () => {
    const summary = reputationSummary({ count: 10, average: 3.0 });
    expect(summary.label).toBe("Mixed reviews");
    expect(summary.tone).toBe(REPUTATION_TONE.NEUTRAL);
  });

  it("labels a poor average 'Needs improvement'", () => {
    const summary = reputationSummary({ count: 10, average: 1.5 });
    expect(summary.label).toBe("Needs improvement");
  });

  it("handles a zero-review seller gracefully", () => {
    const summary = reputationSummary({ count: 0, average: 0 });
    expect(summary.label).toBe("New seller");
  });

  it("no throw on missing/malformed input", () => {
    expect(() => reputationSummary()).not.toThrow();
    expect(() => reputationSummary({})).not.toThrow();
  });
});
