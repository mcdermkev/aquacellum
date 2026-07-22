/**
 * reviewAggregation.js
 *
 * Pure aggregation over a seller's published reviews (Task 20 §3). Computes
 * exactly what `breeder_stats.avg_rating`/`review_count` should hold, plus
 * the per-dimension averages and star distribution the reputation UI
 * renders. Ignores hidden/flagged reviews — moderation removes a review
 * from the public signal without deleting the row (audit trail).
 *
 * `reputationSummary` is the plain-language trust label shown to everyone
 * (`view_reputation` is a REQUIRED entitlement) — never a fake 5.0 for a
 * seller with too few reviews. The only XP-gated piece anywhere in this
 * surface is `deep_reputation_insights` (trend-over-time analysis), which is
 * additive UI built on top of this base aggregate, not implemented here.
 *
 * Pure, deterministic, no network.
 */

const DIMENSIONS = Object.freeze(["health", "accuracy", "packaging", "communication", "fulfillment"]);

// Below this many published reviews, show "New seller" rather than a
// statistically thin average that could mislead (e.g. a single 5-star review
// reading as "perfectly rated").
export const NEW_SELLER_REVIEW_FLOOR = 3;

function round1(n) {
  return Math.round(n * 10) / 10;
}

function isPublished(review) {
  return (review?.status || "published") === "published";
}

/**
 * Aggregate a seller's reviews into the summary the reputation UI and
 * `breeder_stats` both need.
 *
 * @param {Object[]} reviews - raw review rows; each may carry `overall`
 *   (1-5) and any of the DIMENSIONS (1-5 or null/undefined when not
 *   applicable to that order's fulfillment method), plus `status`
 *   ('published' | 'hidden' | 'flagged').
 * @returns {{
 *   count: number,
 *   average: number,
 *   dimensionAverages: { health:(number|null), accuracy:(number|null), packaging:(number|null), communication:(number|null), fulfillment:(number|null) },
 *   distribution: { 5:number, 4:number, 3:number, 2:number, 1:number }
 * }}
 */
export function aggregateReviews(reviews = []) {
  const published = (Array.isArray(reviews) ? reviews : []).filter(isPublished);

  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let overallSum = 0;
  let overallCount = 0;
  const dimensionSums = Object.fromEntries(DIMENSIONS.map((d) => [d, 0]));
  const dimensionCounts = Object.fromEntries(DIMENSIONS.map((d) => [d, 0]));

  for (const review of published) {
    const overall = Number(review.overall);
    if (Number.isFinite(overall) && overall >= 1 && overall <= 5) {
      const bucket = Math.round(overall);
      if (distribution[bucket] != null) distribution[bucket] += 1;
      overallSum += overall;
      overallCount += 1;
    }

    for (const dim of DIMENSIONS) {
      const value = Number(review[dim]);
      if (Number.isFinite(value) && value >= 1 && value <= 5) {
        dimensionSums[dim] += value;
        dimensionCounts[dim] += 1;
      }
    }
  }

  const dimensionAverages = Object.fromEntries(
    DIMENSIONS.map((dim) => [
      dim,
      dimensionCounts[dim] > 0 ? round1(dimensionSums[dim] / dimensionCounts[dim]) : null,
    ])
  );

  return {
    count: overallCount,
    average: overallCount > 0 ? round1(overallSum / overallCount) : 0,
    dimensionAverages,
    distribution,
  };
}

// ─── Reputation summary (universal trust badge) ─────────────────────────────

export const REPUTATION_TONE = Object.freeze({
  GOOD: "good",
  NEUTRAL: "neutral",
  NEW: "new",
});

/**
 * Turn an aggregate into a plain-language reputation label + tone for the
 * universal trust badge (never color-only — pair with the numeric average
 * and count in the UI). Below `NEW_SELLER_REVIEW_FLOOR` reviews, the label
 * is always "New seller" regardless of the (statistically thin) average —
 * never presents a guess as an established reputation.
 *
 * @param {{ count:number, average:number }} aggregate - aggregateReviews output
 * @returns {{ label:string, tone:string }}
 */
export function reputationSummary(aggregate = {}) {
  const count = Number(aggregate.count) || 0;
  const average = Number(aggregate.average) || 0;

  if (count < NEW_SELLER_REVIEW_FLOOR) {
    return { label: "New seller", tone: REPUTATION_TONE.NEW };
  }
  if (average >= 4.5) {
    return { label: "Highly rated", tone: REPUTATION_TONE.GOOD };
  }
  if (average >= 3.5) {
    return { label: "Well reviewed", tone: REPUTATION_TONE.GOOD };
  }
  if (average >= 2.5) {
    return { label: "Mixed reviews", tone: REPUTATION_TONE.NEUTRAL };
  }
  return { label: "Needs improvement", tone: REPUTATION_TONE.NEUTRAL };
}
