/**
 * Component-level guards for the Task 20 review actions added to
 * frontend/api/storefront-detail.js (server never trusts the client's own
 * eligibility check — docs/TASK_20_REVIEWS_SPEC.md §2/§6 acceptance
 * criterion: "Server-side eligibility must be re-verified... assert the
 * endpoint rejects a non-buyer (403), a duplicate (409), and an incomplete
 * order (422)").
 *
 * storefront-detail.js pulls in @supabase/supabase-js and other server-only
 * deps, so — matching the established source-guard convention
 * (parcelPresetsEndpoint.catalog.test.js, listingDescriptionDraft.catalog.
 * test.js) — this asserts the contract statically over the comment-stripped
 * source. Lives under src/__tests__/ because vite.config.js's vitest
 * `include` only scans `src/**\/*.test.{js,jsx}`, not `api/`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../../api/storefront-detail.js", import.meta.url)), "utf8")
);

describe("review actions — registered distinctly from the existing storefront actions", () => {
  it("routes reviews/review-for-order/submit-review/respond-review/report-review/moderate-review", () => {
    for (const [action, handler] of [
      ["reviews", "handleGetReviews"],
      ["review-for-order", "handleGetReviewForOrder"],
      ["submit-review", "handleSubmitReview"],
      ["respond-review", "handleRespondReview"],
      ["report-review", "handleReportReview"],
      ["moderate-review", "handleModerateReview"],
    ]) {
      expect(SOURCE).toContain(`case "${action}":`);
      expect(SOURCE).toContain(`return ${handler}(req, res);`);
    }
  });
});

describe("submit-review — server re-verifies eligibility via reviewEligibility.js, never trusts the client", () => {
  it("imports isOrderReviewable/applicableRatingDimensions from the shared eligibility module", () => {
    const normalized = SOURCE.replace(/\s+/g, " ");
    expect(normalized).toContain(
      'import { isOrderReviewable, applicableRatingDimensions, canRespondToReview, } from "../src/services/reviewEligibility.js"'
    );
  });

  it("handleSubmitReview calls isOrderReviewable with the order's buyer_wallet and legacyStatus", () => {
    const idx = SOURCE.indexOf("async function handleSubmitReview(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 3500);
    expect(block).toContain("isOrderReviewable(");
    expect(block).toContain("legacyStatus: orderRow.status");
  });

  it("returns 403 for a non-buyer, 409 for a duplicate, and 422 for an incomplete order", () => {
    const idx = SOURCE.indexOf("async function handleSubmitReview(req, res) {");
    const block = SOURCE.slice(idx, idx + 3500);
    expect(block).toMatch(/res\.status\(403\)/);
    expect(block).toMatch(/res\.status\(409\)/);
    expect(block).toMatch(/res\.status\(422\)/);
  });

  it("derives the reviewer wallet ONLY from the verified session token, never the request body", () => {
    const idx = SOURCE.indexOf("async function requireReviewerWallet(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 700);
    expect(block).toContain("await verifyPrivyToken(req)");
    expect(block).not.toMatch(/req\.body\??\.\s*wallet/i);
  });

  it("sanitizes sub-ratings against applicableRatingDimensions before writing (never trusts client-supplied dimensions)", () => {
    const idx = SOURCE.indexOf("async function handleSubmitReview(req, res) {");
    const block = SOURCE.slice(idx, idx + 3500);
    expect(block).toContain("applicableRatingDimensions(method)");
    expect(block).toContain("allowedDims.has(");
  });
});

describe("respond-review — seller-response eligibility decided by canRespondToReview", () => {
  it("handleRespondReview calls canRespondToReview before writing the response", () => {
    const idx = SOURCE.indexOf("async function handleRespondReview(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 1200);
    expect(block).toContain("canRespondToReview(");
    expect(block).toMatch(/res\.status\(403\)/);
  });
});

describe("moderate-review — curator-only, mirrors api/stripe.js's authorizeAdminOrCurator pattern", () => {
  it("handleModerateReview requires authorizeCuratorForReviews before touching the database", () => {
    const idx = SOURCE.indexOf("async function handleModerateReview(req, res) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 500);
    expect(block).toContain("await authorizeCuratorForReviews(req)");
  });

  it("authorizeCuratorForReviews checks CRON_SECRET or a verified curator wallet, matching the CURATOR_WALLET env pattern", () => {
    const idx = SOURCE.indexOf("async function authorizeCuratorForReviews(req) {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, idx + 900);
    expect(block).toContain("process.env.CRON_SECRET");
    expect(block).toContain("process.env.CURATOR_WALLET");
    expect(block).toContain("verifyPrivyToken(req)");
  });
});

describe("review reads — public, no auth required (view_reputation is REQUIRED)", () => {
  it("handleGetReviews and handleGetReviewForOrder never call requireReviewerWallet or a curator check", () => {
    const reviewsIdx = SOURCE.indexOf("async function handleGetReviews(req, res) {");
    const reviewsBlock = SOURCE.slice(reviewsIdx, reviewsIdx + 1200);
    expect(reviewsBlock).not.toMatch(/requireReviewerWallet|authorizeCuratorForReviews/);

    const forOrderIdx = SOURCE.indexOf("async function handleGetReviewForOrder(req, res) {");
    const forOrderBlock = SOURCE.slice(forOrderIdx, forOrderIdx + 900);
    expect(forOrderBlock).not.toMatch(/requireReviewerWallet|authorizeCuratorForReviews/);
  });
});
