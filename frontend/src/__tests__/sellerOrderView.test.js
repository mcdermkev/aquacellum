/**
 * Unit tests for sellerOrderView.js — the canonical-state-aware normalizer for
 * seller-facing order views (Task 19). See docs/TASK_19_SELLER_OPS_SPEC.md §4.
 *
 * Run with: npx vitest --run src/__tests__/sellerOrderView.test.js
 */

import { describe, it, expect } from "vitest";
import { ORDER_STATES as S, FULFILLMENT_METHODS as M } from "../services/marketplaceStateMachine.js";
import { containsProhibitedTerm, SELLER_ACTION_KIND as SA, sellerNextActionKind } from "../services/orderCopy.js";
import { buildBreederDashboard } from "../services/breederDashboard.js";
import {
  resolvePayout,
  resolveCustomer,
  assembleSellerOrderView,
  normalizeSellerOrders,
  filterSellerOrders,
} from "../services/sellerOrderView.js";

// ─── Fixture builders (mirror real Dexie marketOrders shapes) ───────────────

function shippingOrder(overrides = {}) {
  return {
    orderType: "shipping",
    tokenId: 101,
    status: 0, // LOCKED
    commonName: "Neon Tetra",
    buyer: "0xbuyer0000000000000000000000000000000001",
    seller: "0xseller000000000000000000000000000000001",
    role: "Seller",
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
    buyer: "0xbuyer0000000000000000000000000000000001",
    seller: "0xseller000000000000000000000000000000001",
    role: "Seller",
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
    buyer: "0xbuyer0000000000000000000000000000000001",
    seller: "0xseller000000000000000000000000000000001",
    items: "[]",
    status: "pending",
    createdAt: 3000,
    ...overrides,
  };
}

function cloudOrder(overrides = {}) {
  return {
    status: "locked",
    order_type: "shipping",
    subtotal_cents: 10000,
    platform_fee_cents: 400,
    total_paid_cents: 10000,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ─── sellerNextActionKind — worked examples from the spec §2 ────────────────

describe("sellerNextActionKind — spec §2 worked examples", () => {
  it("shipping + payment_protected -> buy_label", () => {
    expect(sellerNextActionKind(M.SHIPPING, S.PAYMENT_PROTECTED)).toBe(SA.BUY_LABEL);
  });

  it("shipping + preparing -> buy_label", () => {
    expect(sellerNextActionKind(M.SHIPPING, S.PREPARING)).toBe(SA.BUY_LABEL);
  });

  it("shipping + in_transit -> awaiting_buyer", () => {
    expect(sellerNextActionKind(M.SHIPPING, S.IN_TRANSIT)).toBe(SA.AWAITING_BUYER);
  });

  it("courier + payment_protected -> request_courier", () => {
    expect(sellerNextActionKind(M.COURIER, S.PAYMENT_PROTECTED)).toBe(SA.REQUEST_COURIER);
  });

  it("prepaid_pickup + payment_protected -> schedule_pickup", () => {
    expect(sellerNextActionKind(M.PREPAID_PICKUP, S.PAYMENT_PROTECTED)).toBe(SA.SCHEDULE_PICKUP);
  });

  it("prepaid_pickup + pickup_ready -> scan_handoff", () => {
    expect(sellerNextActionKind(M.PREPAID_PICKUP, S.PICKUP_READY)).toBe(SA.SCAN_HANDOFF);
  });

  it("cash_pickup + pickup_ready -> confirm_cash", () => {
    expect(sellerNextActionKind(M.CASH_PICKUP, S.PICKUP_READY)).toBe(SA.CONFIRM_CASH);
  });

  it("claim_open -> respond_to_claim for every method", () => {
    for (const method of Object.values(M)) {
      expect(sellerNextActionKind(method, S.CLAIM_OPEN)).toBe(SA.RESPOND_TO_CLAIM);
    }
  });

  it("hasOpenClaim flag forces respond_to_claim even off claim_open state", () => {
    expect(sellerNextActionKind(M.SHIPPING, S.IN_TRANSIT, { hasOpenClaim: true })).toBe(SA.RESPOND_TO_CLAIM);
  });

  it("terminal completed-family states -> view_receipt for every method", () => {
    for (const method of Object.values(M)) {
      for (const state of [S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED, S.REFUNDED, S.CANCELLED]) {
        expect(sellerNextActionKind(method, state)).toBe(SA.VIEW_RECEIPT);
      }
    }
  });

  it("is deterministic across repeated calls", () => {
    const a = sellerNextActionKind(M.SHIPPING, S.PAYMENT_PROTECTED);
    const b = sellerNextActionKind(M.SHIPPING, S.PAYMENT_PROTECTED);
    expect(a).toBe(b);
  });
});

// ─── Payout bucket parity (spec §4 criterion 3) ─────────────────────────────

describe("resolvePayout — parity with buildBreederDashboard's earnings bucket", () => {
  it("a single locked cloud-shaped order's bucket matches the dashboard's protected bucket", () => {
    const order = cloudOrder({ status: "locked", subtotal_cents: 10000, platform_fee_cents: 400 });
    const { earnings } = buildBreederDashboard({ orders: [order] });
    const { bucket, proceedsCents } = resolvePayout(order);
    expect(bucket).toBe("protected");
    expect(proceedsCents).toBe(earnings.protectedCents);
  });

  it("released/completed/settled cloud orders resolve to 'available', matching the dashboard sum", () => {
    for (const status of ["released", "resolved_released", "completed", "settled"]) {
      const order = cloudOrder({ status, subtotal_cents: 5000, platform_fee_cents: 200 });
      const { earnings } = buildBreederDashboard({ orders: [order] });
      const { bucket, proceedsCents } = resolvePayout(order);
      expect(bucket).toBe("available");
      expect(proceedsCents).toBe(earnings.availableCents);
    }
  });

  it("disputed cloud orders resolve to 'frozen', matching the dashboard sum", () => {
    const order = cloudOrder({ status: "disputed", subtotal_cents: 4000, platform_fee_cents: 160 });
    const { earnings } = buildBreederDashboard({ orders: [order] });
    const { bucket, proceedsCents } = resolvePayout(order);
    expect(bucket).toBe("frozen");
    expect(proceedsCents).toBe(earnings.frozenCents);
  });

  it("pending/failed/refunded cloud orders resolve to 'none' (excluded from all buckets)", () => {
    for (const status of ["pending", "failed", "refunded"]) {
      const order = cloudOrder({ status });
      expect(resolvePayout(order).bucket).toBe("none");
    }
  });

  it("a legacy Dexie shipping order (status int) resolves via the same legacy status string mapping", () => {
    // status 0 -> "locked" -> protected
    expect(resolvePayout(shippingOrder({ status: 0 })).bucket).toBe("protected");
    // status 1 -> "dispatched" -> protected
    expect(resolvePayout(shippingOrder({ status: 1 })).bucket).toBe("protected");
    // status 2 -> "released" -> available
    expect(resolvePayout(shippingOrder({ status: 2 })).bucket).toBe("available");
    // status 3 -> "disputed" -> frozen
    expect(resolvePayout(shippingOrder({ status: 3 })).bucket).toBe("frozen");
    // status 4 -> "refunded" -> none
    expect(resolvePayout(shippingOrder({ status: 4 })).bucket).toBe("none");
  });

  it("a legacy Dexie batch order (state int) resolves via the same legacy status string mapping", () => {
    expect(resolvePayout(batchOrder({ state: 0 })).bucket).toBe("none"); // "pending" -> excluded
    expect(resolvePayout(batchOrder({ state: 1 })).bucket).toBe("available"); // "released"
    expect(resolvePayout(batchOrder({ state: 2 })).bucket).toBe("none"); // "refunded" -> excluded
  });

  it("proceedsCents falls back to amountLocked dollars->cents for local orders without itemized fees", () => {
    const { proceedsCents } = resolvePayout(shippingOrder({ amountLocked: "12.34" }));
    expect(proceedsCents).toBe(1234);
  });
});

// ─── Customer privacy (alias only) ──────────────────────────────────────────

describe("resolveCustomer — privacy-conscious alias only", () => {
  it("returns a deterministic alias derived from the buyer address, never the raw address", () => {
    const order = shippingOrder({ buyer: "0xabc0000000000000000000000000000000dead" });
    const { alias } = resolveCustomer(order);
    expect(alias).not.toContain("0xabc");
    expect(typeof alias).toBe("string");
    expect(alias.length).toBeGreaterThan(0);
  });

  it("same buyer address always yields the same alias (deterministic)", () => {
    const a = resolveCustomer(shippingOrder({ buyer: "0x1111111111111111111111111111111111111a" }));
    const b = resolveCustomer(shippingOrder({ buyer: "0x1111111111111111111111111111111111111a" }));
    expect(a.alias).toBe(b.alias);
  });
});

// ─── assembleSellerOrderView — Web2 language invariant ──────────────────────

describe("assembleSellerOrderView — Web2 language invariant on assembled views", () => {
  it("status label and seller next-action copy are free of prohibited terms for every fixture", () => {
    const fixtures = [
      shippingOrder({ status: 0 }), shippingOrder({ status: 1 }), shippingOrder({ status: 2 }),
      shippingOrder({ status: 3 }), shippingOrder({ status: 4 }),
      batchOrder({ state: 0, fulfillmentType: 0 }), batchOrder({ state: 0, fulfillmentType: 1 }),
      batchOrder({ state: 1 }), batchOrder({ state: 2 }),
      fiatOrder({ status: "pending" }), fiatOrder({ status: "settled" }), fiatOrder({ status: "disputed" }),
    ];
    for (const order of fixtures) {
      const view = assembleSellerOrderView(order);
      expect(containsProhibitedTerm(view.status.label), `status label for ${JSON.stringify(order)}`).toBe(false);
      expect(containsProhibitedTerm(view.sellerNextAction.copy), `seller next action for ${JSON.stringify(order)}`).toBe(false);
    }
  });
});

describe("assembleSellerOrderView — identity + basic shape", () => {
  it("produces the same stable id scheme as buyerOrderView (ship-/batch-/fiat-)", () => {
    expect(assembleSellerOrderView(shippingOrder({ tokenId: 5 })).id).toBe("ship-5");
    expect(assembleSellerOrderView(batchOrder({ purchaseId: 9 })).id).toBe("batch-9");
    expect(assembleSellerOrderView(fiatOrder({ stripeSessionId: "cs_abc" })).id).toBe("fiat-cs_abc");
  });

  it("claim.state is 'open' exactly when canonicalState is claim_open", () => {
    expect(assembleSellerOrderView(shippingOrder({ status: 3 })).claim.state).toBe("open");
    expect(assembleSellerOrderView(shippingOrder({ status: 1 })).claim.state).toBe("none");
  });
});

// ─── normalizeSellerOrders + filterSellerOrders ─────────────────────────────

describe("normalizeSellerOrders + filterSellerOrders", () => {
  const orders = [
    shippingOrder({ tokenId: 1, status: 0, createdAt: 100, commonName: "Angelfish" }), // needs_action (buy_label)
    shippingOrder({ tokenId: 2, status: 1, createdAt: 300, commonName: "Betta" }), // in_progress (awaiting_buyer)
    shippingOrder({ tokenId: 3, status: 3, createdAt: 200, commonName: "Corydoras" }), // claims
    batchOrder({ purchaseId: 9, state: 1, createdAt: 400, commonName: "Molly Fry" }), // completed
    batchOrder({ purchaseId: 10, state: 0, fulfillmentType: 1, createdAt: 500, commonName: "Guppy" }), // needs_action (schedule_pickup)
  ];

  it("default status filter (needs_action) matches only orders with an actionable seller kind", () => {
    // ship-1 (buy_label), batch-10 (schedule_pickup), and ship-3 (claim_open ->
    // respond_to_claim) are all actionable kinds; ship-2 (awaiting_buyer) and
    // batch-9 (terminal -> view_receipt) are not.
    const views = normalizeSellerOrders(orders);
    const needsAction = filterSellerOrders(views);
    expect(new Set(needsAction.map((v) => v.id))).toEqual(new Set(["ship-1", "batch-10", "ship-3"]));
  });

  it("status=in_progress returns only awaiting_buyer orders", () => {
    const views = normalizeSellerOrders(orders);
    const inProgress = filterSellerOrders(views, { status: "in_progress" });
    expect(inProgress.map((v) => v.id)).toEqual(["ship-2"]);
  });

  it("status=completed returns handoff-confirmed/settled/refunded orders", () => {
    const views = normalizeSellerOrders(orders);
    const completed = filterSellerOrders(views, { status: "completed" });
    expect(completed.map((v) => v.id)).toEqual(["batch-9"]);
  });

  it("status=claims returns only claim_open/partially_resolved orders", () => {
    const views = normalizeSellerOrders(orders);
    const claims = filterSellerOrders(views, { status: "claims" });
    expect(claims.map((v) => v.id)).toEqual(["ship-3"]);
  });

  it("status=all with fulfillment=shipping returns only shipping-method orders", () => {
    // batch-9 defaults to fulfillmentType 0 (shipping), so it's included
    // alongside the three shipping orderType fixtures.
    const views = normalizeSellerOrders(orders);
    const shippingOnly = filterSellerOrders(views, { status: "all", fulfillment: "shipping" });
    expect(new Set(shippingOnly.map((v) => v.id))).toEqual(new Set(["ship-1", "ship-2", "ship-3", "batch-9"]));
  });

  it("fulfillment=prepaid_pickup returns only prepaid-pickup-method orders", () => {
    const views = normalizeSellerOrders(orders);
    const pickupOnly = filterSellerOrders(views, { status: "all", fulfillment: "prepaid_pickup" });
    expect(pickupOnly.map((v) => v.id)).toEqual(["batch-10"]);
  });

  it("search matches common name case-insensitively", () => {
    const views = normalizeSellerOrders(orders);
    const found = filterSellerOrders(views, { status: "all", query: "angel" });
    expect(found.map((v) => v.id)).toEqual(["ship-1"]);
  });

  it("search matches the customer alias", () => {
    const views = normalizeSellerOrders(orders);
    const alias = views[0].customer.alias;
    const found = filterSellerOrders(views, { status: "all", query: alias });
    expect(found.length).toBeGreaterThan(0);
  });

  it("results are sorted newest-first by default and deterministic", () => {
    const views = normalizeSellerOrders(orders);
    const all = filterSellerOrders(views, { status: "all" });
    const a = all.map((v) => v.id);
    const b = filterSellerOrders(views, { status: "all" }).map((v) => v.id);
    expect(a).toEqual(b);
    expect(all.map((v) => v.createdAt)).toEqual([500, 400, 300, 200, 100]);
  });

  it("ties break deterministically by stable id", () => {
    const tied = [
      shippingOrder({ tokenId: 5, createdAt: 100 }),
      shippingOrder({ tokenId: 2, createdAt: 100 }),
    ];
    const views = normalizeSellerOrders(tied);
    const sorted = filterSellerOrders(views, { status: "all" });
    expect(sorted.map((v) => v.id)).toEqual(["ship-2", "ship-5"]);
  });

  it("empty input arrays don't throw and return empty arrays", () => {
    expect(normalizeSellerOrders([])).toEqual([]);
    expect(normalizeSellerOrders(undefined)).toEqual([]);
    expect(filterSellerOrders([])).toEqual([]);
  });
});
