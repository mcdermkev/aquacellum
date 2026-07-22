/**
 * Component-level guards for the review entry point wired into
 * OrderReceipt.jsx (Task 20 §6, acceptance criteria 8-9).
 *
 * Covers the entitlement-guard criterion for the buyer-facing surface:
 * the "leave a review" affordance must be gated ONLY by role + eligibility
 * (isOrderReviewable), never by an XP/tier check — leave_review is a
 * REQUIRED entitlement.
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
  readFileSync(fileURLToPath(new URL("./OrderReceipt.jsx", import.meta.url)), "utf8")
);

describe("OrderReceipt — review section composition (no re-derived eligibility)", () => {
  it("gates the review section on order.role === 'Buyer', mirroring the existing role checks in this file", () => {
    expect(SOURCE).toContain('order.role === "Buyer" && <OrderReviewSection');
  });

  it("decides eligibility via reviewEligibility.isOrderReviewable, not an inline reimplementation", () => {
    expect(SOURCE).toContain('import { isOrderReviewable } from "../services/reviewEligibility"');
    expect(SOURCE).toContain("isOrderReviewable(");
  });

  it("resolves canonical state via buyerOrderView.resolveCanonicalState, not a new status mapping", () => {
    expect(SOURCE).toContain('import { resolveCanonicalState, resolveMethod } from "../services/buyerOrderView"');
    expect(SOURCE).toContain("resolveCanonicalState(order)");
  });

  it("looks up any existing review via reviewsApi.fetchReviewForOrder, not a raw fetch", () => {
    expect(SOURCE).toContain('import { fetchReviewForOrder } from "../services/reviewsApi"');
    expect(SOURCE).toContain("await fetchReviewForOrder(orderRef)");
  });

  it("never imports hasEntitlement or checks xp/tier to decide whether the review section renders", () => {
    expect(SOURCE).not.toMatch(/hasEntitlement/);
    expect(SOURCE).not.toMatch(/\bctx\.xp\b|\.xp\s*[><=]/);
  });

  it("mounts the actual composer (ReviewComposer), not a bespoke form", () => {
    expect(SOURCE).toContain('import { ReviewComposer } from "./reviews/ReviewComposer"');
    expect(SOURCE).toContain("<ReviewComposer");
  });
});
