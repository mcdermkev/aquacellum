/**
 * Component-level guards for the Task 20 review UI components
 * (docs/TASK_20_REVIEWS_SPEC.md §6 acceptance criteria 8-9).
 *
 * This project's vitest runs in a `node` environment (no jsdom /
 * testing-library) — see vite.config.js `test.environment: 'node'`. Following
 * the established source-guard convention (BreederTerminal.catalog.test.js,
 * ListSpecimenModal.catalog.test.js), this asserts composition and the
 * entitlement contract statically over the comment-stripped source.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function loadSource(filename) {
  return stripComments(readFileSync(fileURLToPath(new URL(`./${filename}`, import.meta.url)), "utf8"));
}

const COMPOSER_SOURCE = loadSource("ReviewComposer.jsx");
const REPUTATION_SOURCE = loadSource("SellerReputation.jsx");
const MODERATION_SOURCE = loadSource("ReviewModerationPanel.jsx");
const STARS_SOURCE = loadSource("ReviewStars.jsx");

// ─── ReviewComposer — composition ───────────────────────────────────────────

describe("ReviewComposer — composes reviewsApi/reviewEligibility, no re-implementation", () => {
  it("submits via reviewsApi.submitReview, not a raw fetch call", () => {
    expect(COMPOSER_SOURCE).toContain('import { submitReview } from "../../services/reviewsApi"');
    expect(COMPOSER_SOURCE).toContain("await submitReview({");
    expect(COMPOSER_SOURCE).not.toMatch(/fetch\(/);
  });

  it("derives applicable sub-ratings from reviewEligibility.applicableRatingDimensions, not a hardcoded list", () => {
    expect(COMPOSER_SOURCE).toContain(
      'import { applicableRatingDimensions } from "../../services/reviewEligibility"'
    );
    expect(COMPOSER_SOURCE).toContain("applicableRatingDimensions(fulfillmentMethod)");
  });

  it("never imports hasEntitlement — leaving a review is a REQUIRED entitlement, this component doesn't gate it", () => {
    expect(COMPOSER_SOURCE).not.toMatch(/hasEntitlement/);
    expect(COMPOSER_SOURCE).not.toMatch(/entitlements\.js/);
  });

  it("the rating widget uses accessible radiogroup/radio ARIA semantics with keyboard support", () => {
    expect(COMPOSER_SOURCE).toContain('role="radiogroup"');
    expect(COMPOSER_SOURCE).toContain('role="radio"');
    expect(COMPOSER_SOURCE).toContain("aria-checked");
    expect(COMPOSER_SOURCE).toMatch(/ArrowRight|ArrowLeft/);
  });

  it("does not itself decide eligibility — no isOrderReviewable import (that's the caller's + server's job)", () => {
    expect(COMPOSER_SOURCE).not.toMatch(/isOrderReviewable/);
  });
});

// ─── SellerReputation — composition + universal availability ───────────────

describe("SellerReputation — composes reviewAggregation, never gates view_reputation", () => {
  it("computes its summary via aggregateReviews/reputationSummary, not ad-hoc math", () => {
    expect(REPUTATION_SOURCE).toContain(
      'import { aggregateReviews, reputationSummary } from "../../services/reviewAggregation"'
    );
    expect(REPUTATION_SOURCE).toContain("aggregateReviews(reviews)");
    expect(REPUTATION_SOURCE).toContain("reputationSummary(aggregate)");
  });

  it("never imports hasEntitlement or checks xp/tier before rendering the reputation summary — view_reputation is REQUIRED", () => {
    expect(REPUTATION_SOURCE).not.toMatch(/hasEntitlement/);
    expect(REPUTATION_SOURCE).not.toMatch(/\bctx\.xp\b|\bctx\.tier\b/);
  });

  it("does not render a 'deep_reputation_insights' trend panel — that's a separate, additively-gated caller's concern", () => {
    expect(REPUTATION_SOURCE).not.toMatch(/deep_reputation_insights/);
  });

  it("report/respond actions use authenticated service clients, not raw fetch", () => {
    expect(REPUTATION_SOURCE).toContain(
      'import { fetchSellerReviews, respondToReview } from "../../services/reviewsApi"'
    );
    expect(REPUTATION_SOURCE).toContain(
      'import { reportReview } from "../../services/reefTrustApi"'
    );
    expect(REPUTATION_SOURCE).not.toMatch(/fetch\(/);
  });

  it("seller-response eligibility is decided by canRespondToReview, not re-derived inline", () => {
    expect(REPUTATION_SOURCE).toContain('import { canRespondToReview } from "../../services/reviewEligibility"');
    expect(REPUTATION_SOURCE).toContain("canRespondToReview(");
  });

  it("renders a 'Verified purchase' badge distinguishing reviews from open review spam", () => {
    expect(REPUTATION_SOURCE).toMatch(/Verified purchase/);
  });
});

// ─── ReviewModerationPanel — composes the ModerationPanel pattern ───────────

describe("ReviewModerationPanel — composes the review_reports moderation flow via reviewsApi", () => {
  it("loads and moderates through the signed Reef trust client rather than direct browser Supabase", () => {
    expect(MODERATION_SOURCE).toContain('import { fetchReviewReports, moderateReview } from "../../services/reefTrustApi"');
    expect(MODERATION_SOURCE).toContain("await fetchReviewReports(filter)");
    expect(MODERATION_SOURCE).toContain("await moderateReview(reportId, action)");
    expect(MODERATION_SOURCE).not.toMatch(/\.from\(["']review_reports["']\)/);
  });

  it("offers only hide|dismiss actions (no mute/ban) — matching ?action=moderate-review's contract", () => {
    expect(MODERATION_SOURCE).toContain("ACTION_LABELS");
    expect(MODERATION_SOURCE).toMatch(/dismiss:/);
    expect(MODERATION_SOURCE).toMatch(/hide:/);
    expect(MODERATION_SOURCE).not.toMatch(/mute_24h|mute_7d|\bban\b/);
  });

  it("mirrors ModerationPanel's pending/resolved/all filter tab pattern", () => {
    expect(MODERATION_SOURCE).toContain('"pending"');
    expect(MODERATION_SOURCE).toContain('"resolved"');
    expect(MODERATION_SOURCE).toContain('"all"');
  });
});

// ─── ReviewStars — never color-only ──────────────────────────────────────────

describe("ReviewStars — conveys the rating with text/number, not color/stars alone", () => {
  it("renders the numeric average as text alongside the star icons", () => {
    expect(STARS_SOURCE).toContain("average.toFixed(1)");
  });

  it("provides a full text aria-label describing the rating for assistive tech", () => {
    expect(STARS_SOURCE).toContain('role="img"');
    expect(STARS_SOURCE).toContain("aria-label={`Rated");
  });
});
