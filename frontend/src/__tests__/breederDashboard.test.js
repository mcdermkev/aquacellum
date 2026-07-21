/**
 * Unit tests for the Breeder Terminal dashboard aggregation module (Task 9,
 * Increment 1, Tier B).
 *
 * Covers all six §5 acceptance criteria, with special emphasis on §5.2 (the
 * earnings status mapping), which is the review-gated money-display surface
 * defined exactly in §3.
 *
 * Run with: npx vitest --run src/__tests__/breederDashboard.test.js
 */

import { describe, it, expect } from "vitest";
import { buildBreederDashboard } from "../services/breederDashboard.js";

function order(overrides = {}) {
  return {
    created_at: "2026-01-01T00:00:00.000Z",
    status: "locked",
    order_type: "shipping",
    fulfillment_type: "shipping",
    subtotal_cents: 10000,
    platform_fee_cents: 400,
    total_paid_cents: 10000,
    ...overrides,
  };
}

// ─── §5.1 newOrders ──────────────────────────────────────────────────────────

describe("buildBreederDashboard — newOrders (§5.1)", () => {
  it("counts only orders after lastVisitAt", () => {
    const orders = [
      order({ created_at: "2026-01-01T00:00:00.000Z" }), // before
      order({ created_at: "2026-01-03T00:00:00.000Z" }), // after
      order({ created_at: "2026-01-05T00:00:00.000Z" }), // after
    ];
    const lastVisitAt = new Date("2026-01-02T00:00:00.000Z").getTime();
    const { newOrders } = buildBreederDashboard({ orders, lastVisitAt });
    expect(newOrders.count).toBe(2);
  });

  it("groups new orders by order_type", () => {
    const lastVisitAt = new Date("2026-01-02T00:00:00.000Z").getTime();
    const orders = [
      order({ created_at: "2026-01-03T00:00:00.000Z", order_type: "shipping" }),
      order({ created_at: "2026-01-03T00:00:00.000Z", order_type: "shipping" }),
      order({ created_at: "2026-01-04T00:00:00.000Z", order_type: "batch" }),
      order({ created_at: "2026-01-01T00:00:00.000Z", order_type: "batch" }), // before — excluded
    ];
    const { newOrders } = buildBreederDashboard({ orders, lastVisitAt });
    expect(newOrders.byType).toEqual({ shipping: 2, batch: 1 });
    expect(newOrders.count).toBe(3);
  });

  it("treats every order as new when there is no prior visit", () => {
    const orders = [order(), order(), order()];
    const { newOrders } = buildBreederDashboard({ orders, lastVisitAt: null });
    expect(newOrders.count).toBe(3);
  });

  it("accepts lastVisitAt as an ISO string or a Date, not just epoch ms", () => {
    const orders = [
      order({ created_at: "2026-01-01T00:00:00.000Z" }),
      order({ created_at: "2026-01-05T00:00:00.000Z" }),
    ];
    const asIso = buildBreederDashboard({ orders, lastVisitAt: "2026-01-02T00:00:00.000Z" });
    const asDate = buildBreederDashboard({ orders, lastVisitAt: new Date("2026-01-02T00:00:00.000Z") });
    expect(asIso.newOrders.count).toBe(1);
    expect(asDate.newOrders.count).toBe(1);
  });
});

// ─── §5.2 earnings — the exact §3 status mapping (review-gated) ────────────

describe("buildBreederDashboard — earnings status mapping (§5.2, §3)", () => {
  it("protectedCents sums seller proceeds for locked + dispatched", () => {
    const orders = [
      order({ status: "locked", subtotal_cents: 10000, platform_fee_cents: 400 }), // proceeds 9600
      order({ status: "dispatched", subtotal_cents: 5000, platform_fee_cents: 200 }), // proceeds 4800
    ];
    const { earnings } = buildBreederDashboard({ orders });
    expect(earnings.protectedCents).toBe(9600 + 4800);
    expect(earnings.availableCents).toBe(0);
    expect(earnings.frozenCents).toBe(0);
  });

  it("availableCents sums seller proceeds for released, resolved_released, completed, settled", () => {
    const orders = [
      order({ status: "released", subtotal_cents: 10000, platform_fee_cents: 400 }), // 9600
      order({ status: "resolved_released", subtotal_cents: 2000, platform_fee_cents: 80 }), // 1920
      order({ status: "completed", subtotal_cents: 3000, platform_fee_cents: 120 }), // 2880
      order({ status: "settled", subtotal_cents: 4000, platform_fee_cents: 160 }), // 3840
    ];
    const { earnings } = buildBreederDashboard({ orders });
    expect(earnings.availableCents).toBe(9600 + 1920 + 2880 + 3840);
    expect(earnings.protectedCents).toBe(0);
    expect(earnings.frozenCents).toBe(0);
  });

  it("frozenCents sums seller proceeds for disputed", () => {
    const orders = [order({ status: "disputed", subtotal_cents: 10000, platform_fee_cents: 400 })]; // 9600
    const { earnings } = buildBreederDashboard({ orders });
    expect(earnings.frozenCents).toBe(9600);
    expect(earnings.protectedCents).toBe(0);
    expect(earnings.availableCents).toBe(0);
  });

  it("excludes pending, failed, and refunded from all three buckets", () => {
    const orders = [
      order({ status: "pending", subtotal_cents: 10000, platform_fee_cents: 400 }),
      order({ status: "failed", subtotal_cents: 10000, platform_fee_cents: 400 }),
      order({ status: "refunded", subtotal_cents: 10000, platform_fee_cents: 400 }),
    ];
    const { earnings } = buildBreederDashboard({ orders });
    expect(earnings).toEqual({ protectedCents: 0, availableCents: 0, frozenCents: 0 });
  });

  it("seller proceeds falls back to total_paid_cents when subtotal/fee fields are absent", () => {
    const orders = [
      order({
        status: "locked",
        subtotal_cents: undefined,
        platform_fee_cents: undefined,
        total_paid_cents: 8800,
      }),
    ];
    const { earnings } = buildBreederDashboard({ orders });
    expect(earnings.protectedCents).toBe(8800);
  });

  it("falls back to total_paid_cents when only ONE of subtotal/fee is present", () => {
    const onlySubtotal = order({
      status: "locked",
      subtotal_cents: 10000,
      platform_fee_cents: undefined,
      total_paid_cents: 9999,
    });
    const onlyFee = order({
      status: "locked",
      subtotal_cents: undefined,
      platform_fee_cents: 400,
      total_paid_cents: 8888,
    });
    const { earnings: e1 } = buildBreederDashboard({ orders: [onlySubtotal] });
    const { earnings: e2 } = buildBreederDashboard({ orders: [onlyFee] });
    expect(e1.protectedCents).toBe(9999);
    expect(e2.protectedCents).toBe(8888);
  });

  it("mixed statuses across a realistic order set sum correctly per bucket", () => {
    const orders = [
      order({ status: "locked", subtotal_cents: 10000, platform_fee_cents: 400 }), // protected 9600
      order({ status: "dispatched", subtotal_cents: 20000, platform_fee_cents: 800 }), // protected 19200
      order({ status: "released", subtotal_cents: 5000, platform_fee_cents: 200 }), // available 4800
      order({ status: "completed", subtotal_cents: 3000, platform_fee_cents: 120 }), // available 2880
      order({ status: "disputed", subtotal_cents: 4000, platform_fee_cents: 160 }), // frozen 3840
      order({ status: "pending", subtotal_cents: 999, platform_fee_cents: 40 }), // excluded
      order({ status: "refunded", subtotal_cents: 999, platform_fee_cents: 40 }), // excluded
      order({ status: "failed", subtotal_cents: 999, platform_fee_cents: 40 }), // excluded
    ];
    const { earnings } = buildBreederDashboard({ orders });
    expect(earnings.protectedCents).toBe(9600 + 19200);
    expect(earnings.availableCents).toBe(4800 + 2880);
    expect(earnings.frozenCents).toBe(3840);
  });
});

// ─── §5.3 pendingActions ─────────────────────────────────────────────────────

describe("buildBreederDashboard — pendingActions (§5.3)", () => {
  it("locked + shipping fulfillment counts as toDispatch", () => {
    const orders = [
      order({ status: "locked", fulfillment_type: "shipping" }),
      order({ status: "locked", fulfillment_type: "shipping" }),
      order({ status: "dispatched", fulfillment_type: "shipping" }), // not locked — excluded
    ];
    const { pendingActions } = buildBreederDashboard({ orders });
    expect(pendingActions.toDispatch.count).toBe(2);
    expect(pendingActions.toHandoff.count).toBe(0);
    expect(pendingActions.cashMeets.count).toBe(0);
  });

  it("locked + in_person fulfillment counts as toHandoff", () => {
    const orders = [
      order({ status: "locked", fulfillment_type: "in_person", order_type: "fiat" }),
      order({ status: "locked", fulfillment_type: "in_person", order_type: "fiat" }),
    ];
    const { pendingActions } = buildBreederDashboard({ orders });
    expect(pendingActions.toHandoff.count).toBe(2);
    expect(pendingActions.toDispatch.count).toBe(0);
  });

  it("locked + cash_handshake order_type counts as cashMeets, distinct from toHandoff", () => {
    const orders = [
      order({ status: "locked", fulfillment_type: "in_person", order_type: "cash_handshake" }),
    ];
    const { pendingActions } = buildBreederDashboard({ orders });
    expect(pendingActions.cashMeets.count).toBe(1);
    expect(pendingActions.toHandoff.count).toBe(0);
  });

  it("non-locked orders never appear in any pending bucket", () => {
    const orders = [
      order({ status: "released", fulfillment_type: "shipping" }),
      order({ status: "disputed", fulfillment_type: "in_person" }),
    ];
    const { pendingActions } = buildBreederDashboard({ orders });
    expect(pendingActions.toDispatch.count).toBe(0);
    expect(pendingActions.toHandoff.count).toBe(0);
    expect(pendingActions.cashMeets.count).toBe(0);
  });
});

// ─── §5.4 lowStock ───────────────────────────────────────────────────────────

describe("buildBreederDashboard — lowStock (§5.4)", () => {
  it("flags batch listings at or under the threshold", () => {
    const listings = [
      { isBatch: true, listingId: 1, quantity: 2 }, // at threshold — flagged
      { isBatch: true, listingId: 2, quantity: 1 }, // under — flagged
      { isBatch: true, listingId: 3, quantity: 10 }, // healthy — not flagged
    ];
    const { lowStock } = buildBreederDashboard({ listings });
    expect(lowStock.items.map((i) => i.listingId)).toEqual([1, 2]);
  });

  it("respects a custom lowStockThreshold", () => {
    const listings = [{ isBatch: true, listingId: 1, quantity: 5 }];
    const withDefault = buildBreederDashboard({ listings });
    const withCustom = buildBreederDashboard({ listings, lowStockThreshold: 5 });
    expect(withDefault.lowStock.items.length).toBe(0);
    expect(withCustom.lowStock.items.length).toBe(1);
  });

  it("flags single listings marked sold or inactive", () => {
    const listings = [
      { isBatch: false, tokenId: 1, active: false },
      { isBatch: false, tokenId: 2, status: "sold" },
      { isBatch: false, tokenId: 3, active: true }, // healthy — not flagged
    ];
    const { lowStock } = buildBreederDashboard({ listings });
    expect(lowStock.items.map((i) => i.tokenId).sort()).toEqual([1, 2]);
  });

  it("healthy stock (active singles, well-stocked batches) is never flagged", () => {
    const listings = [
      { isBatch: false, tokenId: 1, active: true },
      { isBatch: true, listingId: 2, quantity: 50 },
    ];
    const { lowStock } = buildBreederDashboard({ listings });
    expect(lowStock.items.length).toBe(0);
  });
});

// ─── §5.5 openClaims ─────────────────────────────────────────────────────────

describe("buildBreederDashboard — openClaims (§5.5)", () => {
  it("counts only disputed orders", () => {
    const orders = [
      order({ status: "disputed" }),
      order({ status: "disputed" }),
      order({ status: "locked" }),
      order({ status: "completed" }),
    ];
    const { openClaims } = buildBreederDashboard({ orders });
    expect(openClaims.count).toBe(2);
    expect(openClaims.items.every((o) => o.status === "disputed")).toBe(true);
  });

  it("zero disputed orders yields an empty (not null/undefined) result", () => {
    const orders = [order({ status: "completed" })];
    const { openClaims } = buildBreederDashboard({ orders });
    expect(openClaims.count).toBe(0);
    expect(openClaims.items).toEqual([]);
  });
});

// ─── §5.6 Determinism ────────────────────────────────────────────────────────

describe("buildBreederDashboard — determinism (§5.6)", () => {
  it("identical inputs produce an identical (deep-equal) model", () => {
    const orders = [
      order({ status: "locked" }),
      order({ status: "released" }),
      order({ status: "disputed" }),
    ];
    const listings = [{ isBatch: true, listingId: 1, quantity: 1 }];
    const lastVisitAt = Date.now();

    const a = buildBreederDashboard({ orders, listings, lastVisitAt });
    const b = buildBreederDashboard({ orders, listings, lastVisitAt });
    expect(a).toEqual(b);
  });

  it("empty inputs yield a zeroed model without throwing", () => {
    const model = buildBreederDashboard({});
    expect(model.newOrders).toEqual({ count: 0, items: [], byType: {} });
    expect(model.pendingActions.toDispatch).toEqual({ count: 0, items: [] });
    expect(model.pendingActions.toHandoff).toEqual({ count: 0, items: [] });
    expect(model.pendingActions.cashMeets).toEqual({ count: 0, items: [] });
    expect(model.earnings).toEqual({ protectedCents: 0, availableCents: 0, frozenCents: 0 });
    expect(model.lowStock).toEqual({ items: [] });
    expect(model.openClaims).toEqual({ count: 0, items: [] });
  });

  it("no throw when called with entirely missing/undefined arguments", () => {
    expect(() => buildBreederDashboard()).not.toThrow();
    expect(() => buildBreederDashboard(undefined)).not.toThrow();
  });

  it("no throw on malformed order rows (missing fields, bad dates)", () => {
    const orders = [{}, { status: "locked" }, { created_at: "not-a-date", status: "released" }];
    expect(() => buildBreederDashboard({ orders })).not.toThrow();
  });
});
