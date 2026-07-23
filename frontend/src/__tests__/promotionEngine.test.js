/**
 * Unit tests for promotionEngine.js — the pure core for Task 21B
 * (promotions & customer segments). See docs/TASK_21B_PROMOTIONS_SPEC.md §5.
 *
 * Run with: npx vitest --run src/__tests__/promotionEngine.test.js
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  evaluatePromotion,
  bestPromotion,
  normalizePromotion,
  validatePromotionDraft,
  PROMOTION_TYPES,
  PROMOTION_SCOPES,
  PROMOTION_FUNDING,
  PROMOTION_COPY,
  MAX_PERCENT_BPS,
  MAX_CODE_LENGTH,
} from "../services/promotionEngine.js";
import { containsProhibitedTerm } from "../services/orderCopy.js";

function cartItem(overrides = {}) {
  return { listingKey: "single-1", unitPriceCents: 1000, quantity: 1, ...overrides };
}

function cart(items) {
  return { items };
}

function promo(overrides = {}) {
  return {
    id: "p1",
    code: null,
    type: PROMOTION_TYPES.PERCENT,
    value: 1000, // 10%
    scope: PROMOTION_SCOPES.STORE,
    scopeRefs: [],
    minSubtotalCents: 0,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    usedCount: 0,
    funding: PROMOTION_FUNDING.SELLER_FUNDED,
    active: true,
    ...overrides,
  };
}

// ─── 1. evaluatePromotion — core rules ───────────────────────────────────────

describe("evaluatePromotion — window / min-subtotal / scope / usage-limit", () => {
  it("applies a store-scope percent discount to the full cart subtotal", () => {
    const result = evaluatePromotion(promo(), cart([cartItem({ unitPriceCents: 1000, quantity: 2 })]));
    expect(result).toEqual({ applicable: true, discountCents: 200, funding: PROMOTION_FUNDING.SELLER_FUNDED, reason: "applicable" });
  });

  it("applies a fixed discount, clamped to the applicable subtotal", () => {
    const result = evaluatePromotion(
      promo({ type: PROMOTION_TYPES.FIXED, value: 5000 }),
      cart([cartItem({ unitPriceCents: 1000, quantity: 1 })])
    );
    expect(result.applicable).toBe(true);
    expect(result.discountCents).toBe(1000); // clamped to the $10 subtotal
  });

  it("rejects a paused promotion", () => {
    const result = evaluatePromotion(promo({ active: false }), cart([cartItem()]));
    expect(result).toEqual({ applicable: false, discountCents: 0, funding: PROMOTION_FUNDING.SELLER_FUNDED, reason: "promotion is paused" });
  });

  it("rejects before startsAt and after endsAt", () => {
    const now = Date.parse("2026-06-15T00:00:00Z");
    const future = evaluatePromotion(promo({ startsAt: "2026-07-01T00:00:00Z" }), cart([cartItem()]), { now });
    expect(future.applicable).toBe(false);
    expect(future.reason).toMatch(/not started/);

    const past = evaluatePromotion(promo({ endsAt: "2026-06-01T00:00:00Z" }), cart([cartItem()]), { now });
    expect(past.applicable).toBe(false);
    expect(past.reason).toMatch(/expired/);
  });

  it("accepts exactly at the window boundaries (inclusive)", () => {
    const now = Date.parse("2026-06-15T00:00:00Z");
    const result = evaluatePromotion(
      promo({ startsAt: "2026-06-15T00:00:00Z", endsAt: "2026-06-15T00:00:00Z" }),
      cart([cartItem()]),
      { now }
    );
    expect(result.applicable).toBe(true);
  });

  it("rejects when usedCount has reached usageLimit", () => {
    const result = evaluatePromotion(promo({ usageLimit: 5, usedCount: 5 }), cart([cartItem()]));
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/usage limit/);
  });

  it("still applies when usedCount is below usageLimit", () => {
    const result = evaluatePromotion(promo({ usageLimit: 5, usedCount: 4 }), cart([cartItem()]));
    expect(result.applicable).toBe(true);
  });

  it("rejects when cart subtotal is below minSubtotalCents", () => {
    const result = evaluatePromotion(promo({ minSubtotalCents: 5000 }), cart([cartItem({ unitPriceCents: 1000 })]));
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/minimum/);
  });

  it("accepts when cart subtotal exactly equals minSubtotalCents", () => {
    const result = evaluatePromotion(promo({ minSubtotalCents: 1000 }), cart([cartItem({ unitPriceCents: 1000 })]));
    expect(result.applicable).toBe(true);
  });

  it("listing-scope: matches only cart lines whose listingKey is in scopeRefs", () => {
    const items = [cartItem({ listingKey: "single-1", unitPriceCents: 1000 }), cartItem({ listingKey: "single-2", unitPriceCents: 2000 })];
    const result = evaluatePromotion(
      promo({ scope: PROMOTION_SCOPES.LISTING, scopeRefs: ["single-1"], value: 1000 }),
      cart(items)
    );
    expect(result.applicable).toBe(true);
    expect(result.discountCents).toBe(100); // 10% of $10, not $30
  });

  it("listing-scope: out-of-scope cart (no matching lines) → applicable:false", () => {
    const items = [cartItem({ listingKey: "single-9", unitPriceCents: 1000 })];
    const result = evaluatePromotion(promo({ scope: PROMOTION_SCOPES.LISTING, scopeRefs: ["single-1"] }), cart(items));
    expect(result).toMatchObject({ applicable: false, discountCents: 0, reason: "no matching items in cart" });
  });

  it("collection-scope: matches cart lines whose collectionRefs intersect scopeRefs", () => {
    const items = [cartItem({ collectionRefs: ["col-a"], unitPriceCents: 1000 }), cartItem({ collectionRefs: ["col-b"], unitPriceCents: 2000 })];
    const result = evaluatePromotion(
      promo({ scope: PROMOTION_SCOPES.COLLECTION, scopeRefs: ["col-a"], value: 1000 }),
      cart(items)
    );
    expect(result.applicable).toBe(true);
    expect(result.discountCents).toBe(100);
  });

  it("collection-scope: cart items with no collectionRefs never match (never guesses)", () => {
    const items = [cartItem({ unitPriceCents: 1000 })]; // no collectionRefs attached
    const result = evaluatePromotion(promo({ scope: PROMOTION_SCOPES.COLLECTION, scopeRefs: ["col-a"] }), cart(items));
    expect(result.applicable).toBe(false);
  });

  it("expired AND over-limit AND out-of-scope all resolve to applicable:false, not a thrown error", () => {
    const now = Date.parse("2026-06-15T00:00:00Z");
    const result = evaluatePromotion(
      promo({ endsAt: "2026-01-01T00:00:00Z", usageLimit: 1, usedCount: 1, scope: PROMOTION_SCOPES.LISTING, scopeRefs: ["single-99"] }),
      cart([cartItem()]),
      { now }
    );
    expect(result.applicable).toBe(false);
  });
});

describe("evaluatePromotion — discount amount safety", () => {
  it("never exceeds the applicable subtotal even for a large percent value", () => {
    const result = evaluatePromotion(promo({ value: MAX_PERCENT_BPS }), cart([cartItem({ unitPriceCents: 999 })]));
    expect(result.discountCents).toBeLessThanOrEqual(999);
    expect(result.discountCents).toBe(999);
  });

  it("never exceeds the applicable subtotal for a huge fixed value", () => {
    const result = evaluatePromotion(promo({ type: PROMOTION_TYPES.FIXED, value: 1_000_000 }), cart([cartItem({ unitPriceCents: 1500 })]));
    expect(result.discountCents).toBe(1500);
  });

  it("never produces a negative discount", () => {
    const result = evaluatePromotion(promo({ type: PROMOTION_TYPES.FIXED, value: 0 }), cart([cartItem()]));
    expect(result.discountCents).toBeGreaterThanOrEqual(0);
    expect(result.applicable).toBe(false); // zero discount is not "applicable"
  });

  it("carries funding through unchanged for both funding types", () => {
    const seller = evaluatePromotion(promo({ funding: PROMOTION_FUNDING.SELLER_FUNDED }), cart([cartItem()]));
    const platform = evaluatePromotion(promo({ funding: PROMOTION_FUNDING.PLATFORM_FUNDED }), cart([cartItem()]));
    expect(seller.funding).toBe(PROMOTION_FUNDING.SELLER_FUNDED);
    expect(platform.funding).toBe(PROMOTION_FUNDING.PLATFORM_FUNDED);
  });
});

// ─── 2. Purity ────────────────────────────────────────────────────────────────

describe("evaluatePromotion / bestPromotion — purity", () => {
  it("never mutates the input cart or promotion", () => {
    const inputPromo = promo();
    const inputCart = cart([cartItem()]);
    const promoCopy = JSON.parse(JSON.stringify(inputPromo));
    const cartCopy = JSON.parse(JSON.stringify(inputCart));

    evaluatePromotion(inputPromo, inputCart);

    expect(inputPromo).toEqual(promoCopy);
    expect(inputCart).toEqual(cartCopy);
  });

  it("never increments usedCount as a side effect", () => {
    const p = promo({ usedCount: 3 });
    evaluatePromotion(p, cart([cartItem()]));
    expect(p.usedCount).toBe(3);
  });

  it("is deterministic for identical inputs", () => {
    const p = promo();
    const c = cart([cartItem()]);
    expect(evaluatePromotion(p, c)).toEqual(evaluatePromotion(p, c));
  });

  it("bestPromotion never mutates its inputs", () => {
    const promos = [promo({ id: "a", value: 500 }), promo({ id: "b", value: 1000 })];
    const promosCopy = JSON.parse(JSON.stringify(promos));
    const c = cart([cartItem({ unitPriceCents: 1000 })]);
    bestPromotion(promos, c);
    expect(promos).toEqual(promosCopy);
  });

  it("handles empty/malformed input without throwing", () => {
    expect(() => evaluatePromotion(promo(), cart([]))).not.toThrow();
    expect(() => evaluatePromotion(promo(), null)).not.toThrow();
    expect(() => evaluatePromotion(undefined, undefined)).not.toThrow();
    expect(() => bestPromotion([], cart([]))).not.toThrow();
    expect(() => bestPromotion(undefined, undefined)).not.toThrow();
  });
});

// ─── 3. bestPromotion — no stacking, deterministic tiebreak ────────────────

describe("bestPromotion", () => {
  const c = cart([cartItem({ unitPriceCents: 10000, quantity: 1 })]);

  it("picks the single promotion with the highest discountCents (no stacking)", () => {
    const promos = [promo({ id: "a", value: 500 }), promo({ id: "b", value: 2000 }), promo({ id: "c", value: 1000 })];
    const result = bestPromotion(promos, c);
    expect(result.promotion.id).toBe("b");
    expect(result.evaluation.discountCents).toBe(2000); // 20% of $100
  });

  it("breaks ties deterministically by ascending id", () => {
    const promos = [promo({ id: "z", value: 1000 }), promo({ id: "a", value: 1000 })];
    const result = bestPromotion(promos, c);
    expect(result.promotion.id).toBe("a");
  });

  it("skips inapplicable promotions and picks the best of the rest", () => {
    const promos = [promo({ id: "a", active: false, value: 5000 }), promo({ id: "b", value: 500 })];
    const result = bestPromotion(promos, c);
    expect(result.promotion.id).toBe("b");
  });

  it("returns promotion:null with applicable:false when nothing applies", () => {
    const promos = [promo({ active: false })];
    const result = bestPromotion(promos, c);
    expect(result.promotion).toBeNull();
    expect(result.evaluation.applicable).toBe(false);
  });
});

// ─── 4. normalizePromotion / validatePromotionDraft ─────────────────────────

describe("normalizePromotion", () => {
  it("normalizes a snake_case DB row to camelCase, uppercasing the code", () => {
    const row = {
      id: "abc", wallet_address: "0xABC", code: "save10", type: "percent", value: 1000,
      scope: "store", scope_refs: [], min_subtotal_cents: 500, starts_at: "2026-01-01",
      ends_at: "2026-02-01", usage_limit: 100, used_count: 3, funding: "seller_funded", active: true,
    };
    const n = normalizePromotion(row);
    expect(n.walletAddress).toBe("0xabc");
    expect(n.code).toBe("SAVE10");
    expect(n.minSubtotalCents).toBe(500);
    expect(n.usageLimit).toBe(100);
    expect(n.usedCount).toBe(3);
  });

  it("defaults an invalid/missing type/scope/funding to safe values", () => {
    const n = normalizePromotion({});
    expect(n.type).toBe(PROMOTION_TYPES.PERCENT);
    expect(n.scope).toBe(PROMOTION_SCOPES.STORE);
    expect(n.funding).toBe(PROMOTION_FUNDING.SELLER_FUNDED);
    expect(n.active).toBe(true);
  });
});

describe("validatePromotionDraft", () => {
  it("accepts a well-formed automatic store-wide draft", () => {
    expect(validatePromotionDraft(promo({ code: null }))).toEqual({ ok: true, error: null });
  });

  it("rejects a bad type/scope/funding", () => {
    expect(validatePromotionDraft(promo({ type: "nope" })).ok).toBe(false);
    expect(validatePromotionDraft(promo({ scope: "nope" })).ok).toBe(false);
    expect(validatePromotionDraft(promo({ funding: "nope" })).ok).toBe(false);
  });

  it("rejects a percent value over 10000 bps", () => {
    const result = validatePromotionDraft(promo({ value: MAX_PERCENT_BPS + 1 }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/100%/);
  });

  it("rejects a negative value", () => {
    expect(validatePromotionDraft(promo({ value: -1 })).ok).toBe(false);
  });

  it("rejects an over-long or malformed code", () => {
    expect(validatePromotionDraft(promo({ code: "x".repeat(MAX_CODE_LENGTH + 1) })).ok).toBe(false);
    expect(validatePromotionDraft(promo({ code: "has a space" })).ok).toBe(false);
    expect(validatePromotionDraft(promo({ code: "VALID-CODE_1" })).ok).toBe(true);
  });

  it("requires non-empty scopeRefs for collection/listing scope", () => {
    expect(validatePromotionDraft(promo({ scope: PROMOTION_SCOPES.LISTING, scopeRefs: [] })).ok).toBe(false);
    expect(validatePromotionDraft(promo({ scope: PROMOTION_SCOPES.LISTING, scopeRefs: ["single-1"] })).ok).toBe(true);
  });

  it("rejects startsAt >= endsAt", () => {
    const result = validatePromotionDraft(promo({ startsAt: "2026-06-01", endsAt: "2026-05-01" }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/before/);
  });

  it("rejects a non-positive usageLimit when set", () => {
    expect(validatePromotionDraft(promo({ usageLimit: 0 })).ok).toBe(false);
    expect(validatePromotionDraft(promo({ usageLimit: -5 })).ok).toBe(false);
  });
});

// ─── 5. Money-safety guard — no checkout/charge code touched ────────────────

describe("promotionEngine.js — money-safety guard (Tier B stops at the seam)", () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL("../services/promotionEngine.js", import.meta.url)),
    "utf8"
  );
  const STRIPPED = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("does not import api/stripe.js or any checkout module", () => {
    expect(STRIPPED).not.toMatch(/from\s+["'].*api\/stripe/);
    expect(STRIPPED).not.toContain("handleCreateCheckout");
  });

  it("contains no reference to platform fee / seller payout math", () => {
    expect(STRIPPED).not.toMatch(/platformFeeCents\s*=/);
    expect(STRIPPED).not.toMatch(/sellerPayoutCents\s*=/);
  });

  it("never writes/increments used_count or usedCount", () => {
    expect(STRIPPED).not.toMatch(/used_count\s*(=|\+\+|\+=)/);
    expect(STRIPPED).not.toMatch(/usedCount\s*(=|\+\+|\+=)(?!.*normalizePromotion)/);
  });

  it("the checkout seam is documented as a JSDoc contract only, not implemented", () => {
    // Checked against the RAW (unstripped) source since the documentation
    // marker deliberately lives inside the JSDoc comment itself.
    expect(SOURCE).toContain("THIS FUNCTION IS INTENTIONALLY NOT IMPLEMENTED IN THIS FILE");
    expect(SOURCE).toContain("CHECKOUT_PROMOTION_SEAM_DOCUMENTED_ONLY");
  });
});

// ─── 6. Web2 language invariant ──────────────────────────────────────────────

describe("PROMOTION_COPY — Web2 language invariant", () => {
  it("every copy string is free of PROHIBITED_TERMS", () => {
    for (const [key, value] of Object.entries(PROMOTION_COPY)) {
      expect(containsProhibitedTerm(value), `PROMOTION_COPY.${key} = "${value}"`).toBe(false);
    }
  });
});
