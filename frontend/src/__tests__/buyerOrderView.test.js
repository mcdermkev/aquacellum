/**
 * Unit tests for buyerOrderView.js — the canonical-state-aware normalizer for
 * buyer-facing order views (Task 18). See docs/TASK_18_BUYER_ORDERS_SPEC.md §4.
 *
 * Run with: npx vitest --run src/__tests__/buyerOrderView.test.js
 */

import { describe, it, expect } from "vitest";
import { ORDER_STATES as S, FULFILLMENT_METHODS as M, STATE_POSITIONS } from "../services/marketplaceStateMachine.js";
import { containsProhibitedTerm } from "../services/orderCopy.js";
import {
  resolveMethod,
  resolveCanonicalState,
  buildTimeline,
  assembleBuyerOrderView,
  normalizeBuyerOrders,
  filterBuyerOrders,
} from "../services/buyerOrderView.js";

// ─── Fixture builders (mirror real Dexie marketOrders shapes) ───────────────

function shippingOrder(overrides = {}) {
  return {
    orderType: "shipping",
    tokenId: 101,
    status: 0, // LOCKED
    commonName: "Neon Tetra",
    buyer: "0xbuyer",
    seller: "0xseller",
    role: "Buyer",
    price: "0.05",
    shippingFee: "0.01",
    amountLocked: "0.06",
    createdAt: 1000,
    dispatchTimestamp: 0,
    arrivedAt: 0,
    trackingNumber: "",
    ...overrides,
  };
}

function batchOrder(overrides = {}) {
  return {
    orderType: "batch",
    purchaseId: 7,
    state: 0, // HELD
    fulfillmentType: 0, // shipping
    quantity: 5,
    commonName: "Guppy Fry",
    buyer: "0xbuyer",
    seller: "0xseller",
    role: "Buyer",
    amountLocked: "0.02",
    createdAt: 2000,
    ...overrides,
  };
}

function fiatOrder(overrides = {}) {
  return {
    orderType: "fiat_pending",
    stripeSessionId: "cs_test_123",
    purchaseType: "shipping",
    buyer: "0xbuyer",
    seller: "0xseller",
    items: "[]",
    status: "pending",
    createdAt: 3000,
    ...overrides,
  };
}

describe("resolveMethod", () => {
  it("maps shipping orderType to SHIPPING", () => {
    expect(resolveMethod(shippingOrder())).toBe(M.SHIPPING);
  });

  it("maps batch fulfillmentType 0 to SHIPPING, 1 to PREPAID_PICKUP", () => {
    expect(resolveMethod(batchOrder({ fulfillmentType: 0 }))).toBe(M.SHIPPING);
    expect(resolveMethod(batchOrder({ fulfillmentType: 1 }))).toBe(M.PREPAID_PICKUP);
  });

  it("maps fiat purchaseType pickup to PREPAID_PICKUP, else SHIPPING", () => {
    expect(resolveMethod(fiatOrder({ purchaseType: "pickup" }))).toBe(M.PREPAID_PICKUP);
    expect(resolveMethod(fiatOrder({ purchaseType: "shipping" }))).toBe(M.SHIPPING);
    expect(resolveMethod(fiatOrder({ purchaseType: "specimen" }))).toBe(M.SHIPPING);
  });

  it("handles null/undefined without throwing", () => {
    expect(resolveMethod(null)).toBe(M.SHIPPING);
    expect(resolveMethod(undefined)).toBe(M.SHIPPING);
  });
});

describe("resolveCanonicalState — shipping (legacy int enum)", () => {
  it.each([
    [0, S.PAYMENT_PROTECTED],
    [1, S.IN_TRANSIT],
    [2, S.COMPLETED],
    [3, S.CLAIM_OPEN],
    [4, S.REFUNDED],
  ])("status %i -> %s", (statusInt, expected) => {
    expect(resolveCanonicalState(shippingOrder({ status: statusInt }))).toBe(expected);
  });
});

describe("resolveCanonicalState — batch (legacy int enum)", () => {
  it("state 0 + shipping fulfillment -> PAYMENT_PROTECTED", () => {
    expect(resolveCanonicalState(batchOrder({ state: 0, fulfillmentType: 0 }))).toBe(S.PAYMENT_PROTECTED);
  });
  it("state 0 + pickup fulfillment -> PICKUP_READY", () => {
    expect(resolveCanonicalState(batchOrder({ state: 0, fulfillmentType: 1 }))).toBe(S.PICKUP_READY);
  });
  it("state 1 -> COMPLETED", () => {
    expect(resolveCanonicalState(batchOrder({ state: 1 }))).toBe(S.COMPLETED);
  });
  it("state 2 -> REFUNDED", () => {
    expect(resolveCanonicalState(batchOrder({ state: 2 }))).toBe(S.REFUNDED);
  });
});

describe("resolveCanonicalState — fiat (legacy cloud status string)", () => {
  it.each([
    ["pending", S.CREATED],
    ["locked", S.PAYMENT_PROTECTED],
    ["dispatched", S.IN_TRANSIT],
    ["released", S.CERTIFICATE_TRANSFERRED],
    ["settled", S.COMPLETED],
    ["disputed", S.CLAIM_OPEN],
    ["refunded", S.REFUNDED],
    ["failed", S.CANCELLED],
  ])("status %s -> %s", (status, expected) => {
    expect(resolveCanonicalState(fiatOrder({ status }))).toBe(expected);
  });
});

describe("assembleBuyerOrderView — positions come from the canonical state machine", () => {
  it("exposes STATE_POSITIONS-consistent money/certificate/inventory via canonicalState", () => {
    const view = assembleBuyerOrderView(shippingOrder({ status: 2 })); // legacy RELEASED -> terminal COMPLETED
    expect(view.canonicalState).toBe(S.COMPLETED);
    expect(STATE_POSITIONS[view.canonicalState]).toMatchObject({ certificate: "transferred" });
  });

  it("claim_open view has money 'frozen' per STATE_POSITIONS", () => {
    const view = assembleBuyerOrderView(shippingOrder({ status: 3 }));
    expect(STATE_POSITIONS[view.canonicalState].money).toBe("frozen");
  });
});

describe("assembleBuyerOrderView — timeline correctness", () => {
  it("shipping: exactly one 'current' step for an in-progress order", () => {
    const view = assembleBuyerOrderView(shippingOrder({ status: 1, dispatchTimestamp: 500 })); // IN_TRANSIT
    const currentSteps = view.timeline.filter((s) => s.state === "current");
    expect(currentSteps.length).toBe(1);
  });

  it("shipping: claim_open replaces the tail with a single alert step", () => {
    const view = assembleBuyerOrderView(shippingOrder({ status: 3 }));
    const last = view.timeline[view.timeline.length - 1];
    expect(last.state).toBe("alert");
    expect(view.timeline.some((s) => s.state === "current")).toBe(false);
  });

  it("shipping: refunded is a terminal two-step timeline", () => {
    const view = assembleBuyerOrderView(shippingOrder({ status: 4 }));
    expect(view.timeline.map((s) => s.key)).toEqual(["placed", "refunded"]);
  });

  it("prepaid pickup: placed -> ready -> handoff, with exactly one current step mid-flow", () => {
    const view = assembleBuyerOrderView(batchOrder({ state: 0, fulfillmentType: 1 }));
    expect(view.timeline.map((s) => s.key)).toEqual(["placed", "ready", "handoff"]);
    expect(view.timeline.filter((s) => s.state === "current").length).toBe(1);
  });

  it("timeline is deterministic — same input always produces the same output", () => {
    const order = shippingOrder({ status: 1, dispatchTimestamp: 500 });
    const a = buildTimeline({ method: resolveMethod(order), canonicalState: resolveCanonicalState(order), timestamps: { createdAt: order.createdAt, dispatchedAt: order.dispatchTimestamp, arrivedAt: order.arrivedAt } });
    const b = buildTimeline({ method: resolveMethod(order), canonicalState: resolveCanonicalState(order), timestamps: { createdAt: order.createdAt, dispatchedAt: order.dispatchTimestamp, arrivedAt: order.arrivedAt } });
    expect(a).toEqual(b);
  });
});

describe("assembleBuyerOrderView — prepaid pickup (the only pickup shape local records produce today)", () => {
  it("a prepaid-pickup-shaped fiat order allows problem reporting (it has payment protection)", () => {
    const view = assembleBuyerOrderView(fiatOrder({ purchaseType: "pickup", status: "locked" }));
    expect(view.method).toBe(M.PREPAID_PICKUP);
    expect(view.claim.allowed).toBe(true);
  });

  // NOTE: no current Dexie/legacy order shape resolves to FULFILLMENT_METHODS.CASH_PICKUP —
  // cash handshake checkout (CheckoutSummary.handleCashCheckout / HandshakeVerification's
  // cash_handshake payload) does not write a marketOrders record today, only a client-side
  // QR handoff. The cash "no DOA" invariant is exercised directly against the pure copy
  // functions in orderCopy.test.js (allowsProblemReport, nextActionKind, cashNoProtectionDisclosure),
  // which is what assembleBuyerOrderView composes and will apply correctly once a cash order
  // representation exists (Task 15/23).
});

describe("assembleBuyerOrderView — Web2 language invariant on assembled views", () => {
  it("status label and next-action copy are free of prohibited terms for every fixture", () => {
    const fixtures = [
      shippingOrder({ status: 0 }), shippingOrder({ status: 1 }), shippingOrder({ status: 2 }),
      shippingOrder({ status: 3 }), shippingOrder({ status: 4 }),
      batchOrder({ state: 0, fulfillmentType: 0 }), batchOrder({ state: 0, fulfillmentType: 1 }),
      batchOrder({ state: 1 }), batchOrder({ state: 2 }),
      fiatOrder({ status: "pending" }), fiatOrder({ status: "settled" }), fiatOrder({ status: "disputed" }),
    ];
    for (const order of fixtures) {
      const view = assembleBuyerOrderView(order);
      expect(containsProhibitedTerm(view.status.label), `status label for ${JSON.stringify(order)}`).toBe(false);
      expect(containsProhibitedTerm(view.nextAction.copy), `next action for ${JSON.stringify(order)}`).toBe(false);
    }
  });
});

describe("normalizeBuyerOrders + filterBuyerOrders", () => {
  const orders = [
    shippingOrder({ tokenId: 1, status: 1, createdAt: 100, amountLocked: "0.10", commonName: "Angelfish" }), // active
    shippingOrder({ tokenId: 2, status: 2, createdAt: 300, amountLocked: "0.20", commonName: "Betta" }), // completed
    shippingOrder({ tokenId: 3, status: 3, createdAt: 200, amountLocked: "0.05", commonName: "Corydoras" }), // disputed
    batchOrder({ purchaseId: 9, state: 1, createdAt: 400, amountLocked: "0.30", commonName: "Molly Fry" }), // completed
  ];

  it("status=active returns only in-progress orders", () => {
    const views = normalizeBuyerOrders(orders);
    const active = filterBuyerOrders(views, { status: "active" });
    expect(active.map((v) => v.id)).toEqual(["ship-1"]);
  });

  it("status=disputed returns only claim_open/partially_resolved orders", () => {
    const views = normalizeBuyerOrders(orders);
    const disputed = filterBuyerOrders(views, { status: "disputed" });
    expect(disputed.map((v) => v.id)).toEqual(["ship-3"]);
  });

  it("status=completed includes handoff-confirmed/settled orders across methods", () => {
    const views = normalizeBuyerOrders(orders);
    const completed = filterBuyerOrders(views, { status: "completed" });
    expect(new Set(completed.map((v) => v.id))).toEqual(new Set(["ship-2", "batch-9"]));
  });

  it("search matches common name case-insensitively", () => {
    const views = normalizeBuyerOrders(orders);
    const found = filterBuyerOrders(views, { status: "all", query: "angel" });
    expect(found.map((v) => v.id)).toEqual(["ship-1"]);
  });

  it("search matches tracking number and numeric ids", () => {
    const views = normalizeBuyerOrders([shippingOrder({ tokenId: 42, trackingNumber: "1Z999AA10123456784" })]);
    expect(filterBuyerOrders(views, { query: "1Z999" }).length).toBe(1);
    expect(filterBuyerOrders(views, { query: "42" }).length).toBe(1);
  });

  it("sort=newest orders by createdAt descending", () => {
    const views = normalizeBuyerOrders(orders);
    const sorted = filterBuyerOrders(views, { status: "all", sort: "newest" });
    expect(sorted.map((v) => v.createdAt)).toEqual([400, 300, 200, 100]);
  });

  it("sort=oldest orders by createdAt ascending", () => {
    const views = normalizeBuyerOrders(orders);
    const sorted = filterBuyerOrders(views, { status: "all", sort: "oldest" });
    expect(sorted.map((v) => v.createdAt)).toEqual([100, 200, 300, 400]);
  });

  it("sort=price_high / price_low order by price descending/ascending", () => {
    const views = normalizeBuyerOrders(orders);
    const high = filterBuyerOrders(views, { status: "all", sort: "price_high" });
    expect(high.map((v) => v.id)).toEqual(["batch-9", "ship-2", "ship-1", "ship-3"]);
    const low = filterBuyerOrders(views, { status: "all", sort: "price_low" });
    expect(low.map((v) => v.id)).toEqual(["ship-3", "ship-1", "ship-2", "batch-9"]);
  });

  it("is deterministic: repeated calls with identical input produce identical order", () => {
    const views = normalizeBuyerOrders(orders);
    const a = filterBuyerOrders(views, { status: "all", sort: "newest" }).map((v) => v.id);
    const b = filterBuyerOrders(views, { status: "all", sort: "newest" }).map((v) => v.id);
    expect(a).toEqual(b);
  });

  it("ties break deterministically by stable id", () => {
    const tied = [
      shippingOrder({ tokenId: 5, createdAt: 100, price: "0.10" }),
      shippingOrder({ tokenId: 2, createdAt: 100, price: "0.10" }),
    ];
    const views = normalizeBuyerOrders(tied);
    const sorted = filterBuyerOrders(views, { sort: "newest" });
    expect(sorted.map((v) => v.id)).toEqual(["ship-2", "ship-5"]);
  });
});

describe("ownership + claim fields", () => {
  it("ownership.transferred is true once handoff/certificate/completed", () => {
    expect(assembleBuyerOrderView(shippingOrder({ status: 2 })).ownership.transferred).toBe(true);
    expect(assembleBuyerOrderView(shippingOrder({ status: 1 })).ownership.transferred).toBe(false);
  });

  it("claim.allowed is false for a terminal (completed/refunded) order", () => {
    expect(assembleBuyerOrderView(shippingOrder({ status: 2 })).claim.allowed).toBe(false);
    expect(assembleBuyerOrderView(shippingOrder({ status: 4 })).claim.allowed).toBe(false);
  });

  it("claim.allowed is true for an in-progress shipping order", () => {
    expect(assembleBuyerOrderView(shippingOrder({ status: 1 })).claim.allowed).toBe(true);
  });
});
