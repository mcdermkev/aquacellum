/**
 * Exhaustive unit tests for the review-eligibility authorization boundary
 * (Task 20, Tier A review gate — docs/TASK_20_REVIEWS_SPEC.md §3/§6).
 *
 * This is the trust/fraud-sensitive module: only the buyer of a verifiably
 * completed order may review, exactly once, and NEVER on an XP/tier basis.
 * Every acceptance criterion in §6.1-§6.5 gets direct coverage here.
 *
 * Run with: npx vitest --run src/__tests__/reviewEligibility.test.js
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  isOrderReviewable,
  applicableRatingDimensions,
  canRespondToReview,
  RATING_DIMENSIONS,
} from "../services/reviewEligibility.js";
import { ORDER_STATES, FULFILLMENT_METHODS } from "../services/marketplaceStateMachine.js";
import { AVAILABLE_STATUSES } from "../services/breederDashboard.js";

const S = ORDER_STATES;
const M = FULFILLMENT_METHODS;

const BUYER = "0xBuyerWallet00000000000000000000000000001";
const SELLER = "0xSellerWallet0000000000000000000000000002";
const STRANGER = "0xStrangerWallet00000000000000000000000003";

function order(overrides = {}) {
  return {
    buyerWallet: BUYER,
    sellerWallet: SELLER,
    canonicalState: S.COMPLETED,
    ...overrides,
  };
}

// ─── §6.1 Author binding (review-gate) ──────────────────────────────────────

describe("isOrderReviewable — author binding (§6.1, review-gate)", () => {
  it("is eligible when the viewer is the order's buyer", () => {
    const result = isOrderReviewable(order(), { viewerWallet: BUYER });
    expect(result.eligible).toBe(true);
  });

  it("is NOT eligible when the viewer is the seller", () => {
    const result = isOrderReviewable(order(), { viewerWallet: SELLER });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/only the buyer/i);
  });

  it("is NOT eligible when the viewer is an unrelated third party", () => {
    const result = isOrderReviewable(order(), { viewerWallet: STRANGER });
    expect(result.eligible).toBe(false);
  });

  it("wallet comparison is case-insensitive", () => {
    const result = isOrderReviewable(order(), { viewerWallet: BUYER.toUpperCase() });
    expect(result.eligible).toBe(true);
  });

  it("is NOT eligible when viewerWallet is missing", () => {
    const result = isOrderReviewable(order(), {});
    expect(result.eligible).toBe(false);
  });

  it("is NOT eligible when the order has no buyerWallet at all", () => {
    const result = isOrderReviewable({ canonicalState: S.COMPLETED }, { viewerWallet: BUYER });
    expect(result.eligible).toBe(false);
  });
});

// ─── §6.2 Verified fulfillment (review-gate) ────────────────────────────────

describe("isOrderReviewable — verified fulfillment (§6.2, review-gate)", () => {
  const eligibleCanonicalStates = [
    S.HANDOFF_CONFIRMED,
    S.CERTIFICATE_TRANSFERRED,
    S.SELLER_PAID,
    S.COMPLETED,
  ];

  for (const state of eligibleCanonicalStates) {
    it(`is eligible for canonical state ${state}, for every fulfillment method`, () => {
      for (const method of Object.values(M)) {
        const result = isOrderReviewable(order({ canonicalState: state, method }), { viewerWallet: BUYER });
        expect(result.eligible, `method=${method} state=${state}`).toBe(true);
      }
    });
  }

  const ineligibleCanonicalStates = [
    S.CREATED, S.PAYMENT_PENDING, S.PAYMENT_PROTECTED, S.PREPARING,
    S.IN_TRANSIT, S.PICKUP_READY, S.DELIVERED, S.REVIEW_WINDOW, S.NON_DELIVERY,
    S.CLAIM_OPEN, S.REFUNDED, S.CANCELLED, S.RECONCILIATION,
  ];

  for (const state of ineligibleCanonicalStates) {
    it(`is NOT eligible for canonical state ${state} (not yet verified / refunded / cancelled / open dispute)`, () => {
      const result = isOrderReviewable(order({ canonicalState: state }), { viewerWallet: BUYER });
      expect(result.eligible, `state=${state}`).toBe(false);
    });
  }

  it("a CASH order post-handoff IS eligible (cash carries reputation consequences per the plan)", () => {
    const result = isOrderReviewable(
      order({ canonicalState: S.HANDOFF_CONFIRMED, method: M.CASH_PICKUP }),
      { viewerWallet: BUYER }
    );
    expect(result.eligible).toBe(true);
  });

  it("a CASH order still open/unconfirmed is NOT eligible", () => {
    const result = isOrderReviewable(
      order({ canonicalState: S.PICKUP_READY, method: M.CASH_PICKUP }),
      { viewerWallet: BUYER }
    );
    expect(result.eligible).toBe(false);
  });

  it("a PARTIAL DOA resolution where healthy fish transferred IS eligible (key case)", () => {
    const result = isOrderReviewable(
      order({ canonicalState: S.PARTIALLY_RESOLVED }),
      { viewerWallet: BUYER }
    );
    expect(result.eligible).toBe(true);
  });

  it("an order with an OPEN claim (unresolved) is NOT eligible", () => {
    const result = isOrderReviewable(order({ canonicalState: S.CLAIM_OPEN }), { viewerWallet: BUYER });
    expect(result.eligible).toBe(false);
  });

  it("a fully REFUNDED order is NOT eligible — no verified purchase occurred", () => {
    const result = isOrderReviewable(order({ canonicalState: S.REFUNDED }), { viewerWallet: BUYER });
    expect(result.eligible).toBe(false);
  });

  it("a CANCELLED order is NOT eligible", () => {
    const result = isOrderReviewable(order({ canonicalState: S.CANCELLED }), { viewerWallet: BUYER });
    expect(result.eligible).toBe(false);
  });

  // Legacy Dexie/cloud `orders.status` fallback — exercised when no
  // canonicalState is present on the order (older rows).
  it("legacy fallback: every AVAILABLE_STATUSES value is eligible when no canonicalState is present", () => {
    for (const status of AVAILABLE_STATUSES) {
      const result = isOrderReviewable(
        { buyerWallet: BUYER, legacyStatus: status },
        { viewerWallet: BUYER }
      );
      expect(result.eligible, `legacyStatus=${status}`).toBe(true);
    }
  });

  it("legacy fallback: pending/failed/refunded/disputed/locked/dispatched are NOT eligible", () => {
    for (const status of ["pending", "failed", "refunded", "disputed", "locked", "dispatched"]) {
      const result = isOrderReviewable(
        { buyerWallet: BUYER, legacyStatus: status },
        { viewerWallet: BUYER }
      );
      expect(result.eligible, `legacyStatus=${status}`).toBe(false);
    }
  });

  it("canonicalState takes precedence over legacyStatus when both are present", () => {
    const result = isOrderReviewable(
      { buyerWallet: BUYER, canonicalState: S.CLAIM_OPEN, legacyStatus: "released" },
      { viewerWallet: BUYER }
    );
    expect(result.eligible).toBe(false);
  });

  it("an order with neither canonicalState nor legacyStatus is NOT eligible (fail closed)", () => {
    const result = isOrderReviewable({ buyerWallet: BUYER }, { viewerWallet: BUYER });
    expect(result.eligible).toBe(false);
  });
});

// ─── §6.3 One per order (review-gate) ───────────────────────────────────────

describe("isOrderReviewable — one review per order (§6.3, review-gate)", () => {
  it("is NOT eligible when an existingReview is present, even though everything else qualifies", () => {
    const result = isOrderReviewable(order(), {
      viewerWallet: BUYER,
      existingReview: { id: "rev_1" },
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/already exists/i);
  });

  it("is eligible when existingReview is explicitly null/undefined", () => {
    expect(isOrderReviewable(order(), { viewerWallet: BUYER, existingReview: null }).eligible).toBe(true);
    expect(isOrderReviewable(order(), { viewerWallet: BUYER, existingReview: undefined }).eligible).toBe(true);
  });
});

// ─── §6.4 Never XP-gated (review-gate) ──────────────────────────────────────

describe("isOrderReviewable — never XP-gated (§6.4, review-gate)", () => {
  it("returns identical eligibility for xp:0 and xp:10000 contexts", () => {
    const base = order();
    const zeroXp = isOrderReviewable(base, { viewerWallet: BUYER, xp: 0 });
    const highXp = isOrderReviewable(base, { viewerWallet: BUYER, xp: 10000 });
    expect(zeroXp).toEqual(highXp);
  });

  it("returns identical eligibility for tier:'Shallow' and tier:'Hadal' contexts", () => {
    const base = order();
    const shallow = isOrderReviewable(base, { viewerWallet: BUYER, tier: "Shallow" });
    const hadal = isOrderReviewable(base, { viewerWallet: BUYER, tier: "Hadal" });
    expect(shallow).toEqual(hadal);
  });

  it("the module's executable code never reads ctx.xp or ctx.tier at all", () => {
    const raw = readFileSync(
      fileURLToPath(new URL("../services/reviewEligibility.js", import.meta.url)),
      "utf8"
    );
    // Strip comments first — the module's own doc comments explain (in
    // prose) that ctx.xp/ctx.tier are deliberately never consulted, which
    // would otherwise false-positive a naive text match. Only the
    // executable code is asserted against here.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/ctx\.xp/);
    expect(code).not.toMatch(/ctx\.tier/);
    expect(code).not.toMatch(/hasEntitlement/);
  });

  it("ineligibility (e.g. wrong viewer) is also unaffected by xp/tier — denial isn't a paywall in disguise", () => {
    const withXp = isOrderReviewable(order(), { viewerWallet: STRANGER, xp: 999999 });
    const withoutXp = isOrderReviewable(order(), { viewerWallet: STRANGER });
    expect(withXp).toEqual(withoutXp);
    expect(withXp.eligible).toBe(false);
  });
});

// ─── §6.5 Applicable rating dimensions ──────────────────────────────────────

describe("applicableRatingDimensions (§6.5)", () => {
  it("includes all dimensions for shipping", () => {
    expect(applicableRatingDimensions(M.SHIPPING)).toEqual(RATING_DIMENSIONS);
  });

  it("includes all dimensions for courier", () => {
    expect(applicableRatingDimensions(M.COURIER)).toEqual(RATING_DIMENSIONS);
  });

  it("omits packaging for prepaid pickup", () => {
    const dims = applicableRatingDimensions(M.PREPAID_PICKUP);
    expect(dims).not.toContain("packaging");
    expect(dims).toContain("health");
    expect(dims).toContain("accuracy");
    expect(dims).toContain("communication");
    expect(dims).toContain("fulfillment");
  });

  it("omits packaging for cash pickup", () => {
    const dims = applicableRatingDimensions(M.CASH_PICKUP);
    expect(dims).not.toContain("packaging");
  });

  it("health/accuracy/communication/fulfillment apply to every method", () => {
    for (const method of Object.values(M)) {
      const dims = applicableRatingDimensions(method);
      for (const universal of ["health", "accuracy", "communication", "fulfillment"]) {
        expect(dims, `method=${method}`).toContain(universal);
      }
    }
  });

  it("is a pure function — repeated calls with the same method return equal arrays", () => {
    expect(applicableRatingDimensions(M.SHIPPING)).toEqual(applicableRatingDimensions(M.SHIPPING));
  });
});

// ─── canRespondToReview ──────────────────────────────────────────────────────

describe("canRespondToReview", () => {
  it("allows the review's own seller to respond when no response exists yet", () => {
    expect(canRespondToReview({ sellerWallet: SELLER }, { viewerWallet: SELLER })).toBe(true);
  });

  it("denies the buyer from responding to their own review", () => {
    expect(canRespondToReview({ sellerWallet: SELLER }, { viewerWallet: BUYER })).toBe(false);
  });

  it("denies a third party from responding", () => {
    expect(canRespondToReview({ sellerWallet: SELLER }, { viewerWallet: STRANGER })).toBe(false);
  });

  it("denies the seller a second response once one already exists", () => {
    expect(
      canRespondToReview({ sellerWallet: SELLER, sellerResponse: "Thanks!" }, { viewerWallet: SELLER })
    ).toBe(false);
  });

  it("wallet comparison is case-insensitive", () => {
    expect(canRespondToReview({ sellerWallet: SELLER }, { viewerWallet: SELLER.toLowerCase() })).toBe(true);
  });
});

// ─── Determinism ─────────────────────────────────────────────────────────────

describe("reviewEligibility — determinism", () => {
  it("identical inputs produce identical output for isOrderReviewable", () => {
    const a = isOrderReviewable(order(), { viewerWallet: BUYER });
    const b = isOrderReviewable(order(), { viewerWallet: BUYER });
    expect(a).toEqual(b);
  });

  it("no throw on empty/missing arguments", () => {
    expect(() => isOrderReviewable()).not.toThrow();
    expect(() => isOrderReviewable({})).not.toThrow();
    expect(() => isOrderReviewable({}, {})).not.toThrow();
    expect(() => applicableRatingDimensions()).not.toThrow();
    expect(() => canRespondToReview()).not.toThrow();
    expect(() => canRespondToReview({})).not.toThrow();
  });
});
