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
      ["review-reports", "handleReviewReports"],
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

describe("review moderation — founder/steward authority matches the UI grant", () => {
  it("list and action handlers require the same server-side keeper-role check", () => {
    for (const handler of ["handleReviewReports", "handleModerateReview"]) {
      const idx = SOURCE.indexOf(`async function ${handler}(req, res) {`);
      expect(idx).toBeGreaterThan(-1);
      const block = SOURCE.slice(idx, idx + 1000);
      expect(block).toContain("await authorizeCuratorForReviews(req)");
    }
  });

  it("keeper authorization consumes a signed actor and checks active founder/steward roles", () => {
    const helperIdx = SOURCE.indexOf("async function authorizeKeeperAuthority(req");
    expect(helperIdx).toBeGreaterThan(-1);
    const block = SOURCE.slice(helperIdx, helperIdx + 1700);
    expect(block).toContain("resolveReefActor(req)");
    expect(block).toContain('from("user_roles")');
    expect(block).toContain('eq("active", true)');
    expect(block).toContain("KEEPER_AUTHORITY_ROLES");
  });

  it("review resolution uses one atomic service-role RPC", () => {
    const idx = SOURCE.indexOf("async function handleModerateReview(req, res) {");
    const block = SOURCE.slice(idx, idx + 1400);
    expect(block).toContain('supabase.rpc("moderate_review_report"');
    expect(block).not.toContain('.from("review_reports").update');
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
