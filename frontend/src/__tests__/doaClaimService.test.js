/**
 * Unit tests for doaClaimService (the wiring layer) using an in-memory store.
 *
 * Proves the DOA workflow (MARKETPLACE_STATE_MODEL.md §5.5) persists correctly
 * without a database: opening a claim freezes release and marks affected items,
 * authorization is enforced (buyer opens, curator resolves), and each
 * resolution outcome (full refund, partial, replacement sub-order, denial)
 * writes the right ledger/line-item/order consequences.
 *
 * Run with: npx vitest --run src/__tests__/doaClaimService.test.js
 */

import { describe, it, expect } from "vitest";
import { openClaim, resolveClaim } from "../services/doaClaimService.js";
import { CLAIM_STATUS, RESOLUTION_OUTCOME, DEFAULT_CLAIM_WINDOW_MS } from "../services/doaClaims.js";
import { ORDER_STATES as S, LINE_ITEM_STATES as L, FULFILLMENT_METHODS as M } from "../services/marketplaceStateMachine.js";
import { LEDGER_ENTRY_TYPES as T } from "../services/paymentLedger.js";

const T0 = 10_000_000;
const buyerActor = { userId: "did:privy:buyer" };
const sellerActor = { walletAddress: "0xseller" };
const curatorActor = { isCurator: true, userId: "did:privy:curator" };

function makeStore({ order, lineItems, claims = [] }) {
  const orders = new Map([[order.id, { ...order }]]);
  const items = new Map(lineItems.map((li) => [li.lineItemId, { ...li }]));
  const claimMap = new Map(claims.map((c) => [c.id, { ...c }]));
  const ledger = new Map(); // orderId → entries
  const transitions = [];
  const subOrders = [];
  let subSeq = 0;

  return {
    _orders: orders, _items: items, _claims: claimMap, _ledger: ledger, _transitions: transitions, _subOrders: subOrders,
    async getOrder(id) { return orders.has(id) ? { ...orders.get(id) } : null; },
    async getLineItems() { return [...items.values()].map((li) => ({ ...li })); },
    async getClaim(id) { return claimMap.has(id) ? { ...claimMap.get(id) } : null; },
    async getOpenClaimForOrder(orderId) {
      return [...claimMap.values()].find((c) => c.orderId === orderId && c.status === CLAIM_STATUS.OPEN) || null;
    },
    async createClaim(claim) {
      const existingOpen = [...claimMap.values()].some((c) => c.orderId === claim.orderId && c.status === CLAIM_STATUS.OPEN);
      if (existingOpen) return { ok: false, error: "an open claim already exists for this order" };
      claimMap.set(claim.id, { ...claim });
      return { ok: true };
    },
    async resolveClaimRow(claimId, { status, resolutions, resolvedAtMs }) {
      const c = claimMap.get(claimId);
      claimMap.set(claimId, { ...c, status, resolutions, resolvedAt: resolvedAtMs });
    },
    async setLineItemStates(updates) {
      for (const u of updates) {
        const li = items.get(u.lineItemId) || { lineItemId: u.lineItemId };
        items.set(u.lineItemId, { ...li, state: u.state, replacementSubOrderId: u.replacementSubOrderId ?? li.replacementSubOrderId });
      }
    },
    async appendLedgerEntries(orderId, entries) {
      const list = ledger.get(orderId) || [];
      for (const e of entries) {
        const dup = e.id != null && list.some((x) => x.type === e.type && x.id === e.id);
        if (!dup) list.push(e);
      }
      ledger.set(orderId, list);
    },
    async createReplacementSubOrder(subOrder) {
      const id = `sub_${++subSeq}`;
      subOrders.push({ id, ...subOrder });
      return id;
    },
    async setOrderState(orderId, state, patch = {}) {
      orders.set(orderId, { ...orders.get(orderId), state, ...patch });
    },
    async recordTransition(row) { transitions.push(row); },
  };
}

function deliveredOrder(overrides = {}) {
  return {
    id: "ord_1",
    state: S.DELIVERED,
    method: M.SHIPPING,
    buyerUserId: "did:privy:buyer",
    buyerWallet: "0xbuyer",
    sellerWallet: "0xseller",
    deliveredAt: T0,
    ...overrides,
  };
}

const twoLineItems = [
  { lineItemId: "li_1", priceCents: 4000, sellerProceedsCents: 3600, state: L.PENDING },
  { lineItemId: "li_2", priceCents: 2000, sellerProceedsCents: 1800, state: L.PENDING },
];

const goodEvidence = { photos: ["a.jpg", "b.jpg"], description: "arrived belly-up" };

describe("openClaim", () => {
  it("buyer opens a claim: freezes release, marks affected items, records the move", async () => {
    const store = makeStore({ order: deliveredOrder(), lineItems: twoLineItems });
    const res = await openClaim({
      store, orderId: "ord_1", affectedLineItemIds: ["li_1"], evidence: goodEvidence,
      actor: buyerActor, now: T0 + 1000, claimId: "claim_1",
    });
    expect(res.ok).toBe(true);
    const order = await store.getOrder("ord_1");
    expect(order.state).toBe(S.CLAIM_OPEN);
    expect(order.has_open_claim).toBe(true);
    expect(store._items.get("li_1").state).toBe(L.DOA_CLAIMED);
    expect(store._items.get("li_2").state).toBe(L.PENDING); // sibling untouched
    expect(store._transitions).toHaveLength(1);
  });

  it("rejects a non-buyer actor and persists nothing", async () => {
    const store = makeStore({ order: deliveredOrder(), lineItems: twoLineItems });
    const res = await openClaim({
      store, orderId: "ord_1", affectedLineItemIds: ["li_1"], evidence: goodEvidence,
      actor: sellerActor, now: T0 + 1000, claimId: "claim_1",
    });
    expect(res.ok).toBe(false);
    expect(store._claims.size).toBe(0);
    expect((await store.getOrder("ord_1")).state).toBe(S.DELIVERED);
  });

  it("rejects insufficient evidence", async () => {
    const store = makeStore({ order: deliveredOrder(), lineItems: twoLineItems });
    const res = await openClaim({
      store, orderId: "ord_1", affectedLineItemIds: ["li_1"], evidence: { photos: ["only-one.jpg"] },
      actor: buyerActor, now: T0 + 1000, claimId: "claim_1",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/evidence/i);
  });

  it("rejects a claim after the window has closed", async () => {
    const store = makeStore({ order: deliveredOrder(), lineItems: twoLineItems });
    const res = await openClaim({
      store, orderId: "ord_1", affectedLineItemIds: ["li_1"], evidence: goodEvidence,
      actor: buyerActor, now: T0 + DEFAULT_CLAIM_WINDOW_MS + 1, claimId: "claim_1",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/window/i);
  });

  it("rejects a claim on a non-eligible order state", async () => {
    const store = makeStore({ order: deliveredOrder({ state: S.PREPARING }), lineItems: twoLineItems });
    const res = await openClaim({
      store, orderId: "ord_1", affectedLineItemIds: ["li_1"], evidence: goodEvidence,
      actor: buyerActor, now: T0 + 1000, claimId: "claim_1",
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a second open claim on the same order", async () => {
    const store = makeStore({ order: deliveredOrder(), lineItems: twoLineItems });
    await openClaim({ store, orderId: "ord_1", affectedLineItemIds: ["li_1"], evidence: goodEvidence, actor: buyerActor, now: T0 + 1000, claimId: "claim_1" });
    // order is now claim_open, so the second attempt fails the state gate anyway;
    // seed a fresh delivered order carrying an existing open claim to isolate the unique guard.
    const store2 = makeStore({
      order: deliveredOrder(),
      lineItems: twoLineItems,
      claims: [{ id: "claim_x", orderId: "ord_1", status: CLAIM_STATUS.OPEN, affectedLineItemIds: ["li_2"] }],
    });
    const res = await openClaim({ store: store2, orderId: "ord_1", affectedLineItemIds: ["li_1"], evidence: goodEvidence, actor: buyerActor, now: T0 + 1000, claimId: "claim_2" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/open claim already exists/i);
  });
});

describe("resolveClaim", () => {
  function openClaimSeed(affected = ["li_1", "li_2"]) {
    return {
      id: "claim_1",
      orderId: "ord_1",
      status: CLAIM_STATUS.OPEN,
      affectedLineItemIds: affected,
      evidence: goodEvidence,
      openedAt: T0 + 1000,
      sellerResponseDeadlineAt: T0 + 1000 + 24 * 3600 * 1000,
      deadlineAt: T0 + DEFAULT_CLAIM_WINDOW_MS,
    };
  }
  const claimOpenOrder = () => deliveredOrder({ state: S.CLAIM_OPEN, has_open_claim: true });

  it("full refund (all items) → order refunded, refund ledger entries, freeze cleared", async () => {
    const store = makeStore({
      order: claimOpenOrder(),
      lineItems: twoLineItems.map((li) => ({ ...li, state: L.DOA_CLAIMED })),
      claims: [openClaimSeed(["li_1", "li_2"])],
    });
    const res = await resolveClaim({
      store, claimId: "claim_1", actor: curatorActor, now: T0 + 5000,
      resolutions: {
        li_1: { outcome: RESOLUTION_OUTCOME.REFUND, refundCents: 4000, sellerPortionCents: 3600 },
        li_2: { outcome: RESOLUTION_OUTCOME.REFUND, refundCents: 2000, sellerPortionCents: 1800 },
      },
    });
    expect(res.ok).toBe(true);
    expect(res.orderState).toBe(S.REFUNDED);
    expect(res.claimStatus).toBe(CLAIM_STATUS.RESOLVED);
    const order = await store.getOrder("ord_1");
    expect(order.state).toBe(S.REFUNDED);
    expect(order.has_open_claim).toBe(false);
    const entries = store._ledger.get("ord_1");
    expect(entries.filter((e) => e.type === T.REFUND)).toHaveLength(2);
    expect(store._items.get("li_1").state).toBe(L.REFUNDED);
  });

  it("partial: one refund + one healthy sibling → partially_resolved", async () => {
    const store = makeStore({
      order: claimOpenOrder(),
      lineItems: [
        { lineItemId: "li_1", priceCents: 4000, sellerProceedsCents: 3600, state: L.DOA_CLAIMED },
        { lineItemId: "li_2", priceCents: 2000, sellerProceedsCents: 1800, state: L.PENDING },
      ],
      claims: [openClaimSeed(["li_1"])],
    });
    const res = await resolveClaim({
      store, claimId: "claim_1", actor: curatorActor, now: T0 + 5000,
      resolutions: { li_1: { outcome: RESOLUTION_OUTCOME.REFUND, refundCents: 4000, sellerPortionCents: 3600 } },
    });
    expect(res.ok).toBe(true);
    expect(res.orderState).toBe(S.PARTIALLY_RESOLVED);
    expect(store._items.get("li_1").state).toBe(L.REFUNDED);
    expect(store._items.get("li_2").state).toBe(L.HEALTHY);
  });

  it("replacement → creates a linked sub-order and marks the item replacement_pending", async () => {
    const store = makeStore({
      order: claimOpenOrder(),
      lineItems: [
        { lineItemId: "li_1", priceCents: 4000, sellerProceedsCents: 3600, state: L.DOA_CLAIMED },
        { lineItemId: "li_2", priceCents: 2000, sellerProceedsCents: 1800, state: L.PENDING },
      ],
      claims: [openClaimSeed(["li_1"])],
    });
    const res = await resolveClaim({
      store, claimId: "claim_1", actor: curatorActor, now: T0 + 5000,
      resolutions: { li_1: { outcome: RESOLUTION_OUTCOME.REPLACE } },
    });
    expect(res.ok).toBe(true);
    expect(res.orderState).toBe(S.PARTIALLY_RESOLVED);
    expect(res.replacementSubOrderIds).toHaveLength(1);
    const subId = res.replacementSubOrderIds[0];
    expect(store._subOrders[0].chargeCents).toBe(0); // no new buyer charge
    expect(store._subOrders[0].replacesLineItemId).toBe("li_1");
    expect(store._items.get("li_1").state).toBe(L.REPLACEMENT_PENDING);
    expect(store._items.get("li_1").replacementSubOrderId).toBe(subId);
    // the resolution audit record carries the sub-order link
    expect(store._claims.get("claim_1").resolutions.li_1.replacementSubOrderId).toBe(subId);
  });

  it("all denied → handoff_confirmed and claim denied", async () => {
    const store = makeStore({
      order: claimOpenOrder(),
      lineItems: [{ lineItemId: "li_1", priceCents: 4000, sellerProceedsCents: 3600, state: L.DOA_CLAIMED }],
      claims: [openClaimSeed(["li_1"])],
    });
    const res = await resolveClaim({
      store, claimId: "claim_1", actor: curatorActor, now: T0 + 5000,
      resolutions: { li_1: { outcome: RESOLUTION_OUTCOME.DENY } },
    });
    expect(res.ok).toBe(true);
    expect(res.orderState).toBe(S.HANDOFF_CONFIRMED);
    expect(res.claimStatus).toBe(CLAIM_STATUS.DENIED);
    expect(store._items.get("li_1").state).toBe(L.DENIED);
    expect((await store.getOrder("ord_1")).has_open_claim).toBe(false);
  });

  it("rejects an unauthorized resolver (buyer cannot adjudicate)", async () => {
    const store = makeStore({
      order: claimOpenOrder(),
      lineItems: twoLineItems.map((li) => ({ ...li, state: L.DOA_CLAIMED })),
      claims: [openClaimSeed(["li_1", "li_2"])],
    });
    const res = await resolveClaim({
      store, claimId: "claim_1", actor: buyerActor, now: T0 + 5000,
      resolutions: {
        li_1: { outcome: RESOLUTION_OUTCOME.REFUND, refundCents: 4000 },
        li_2: { outcome: RESOLUTION_OUTCOME.REFUND, refundCents: 2000 },
      },
    });
    expect(res.ok).toBe(false);
    // nothing mutated
    expect((await store.getOrder("ord_1")).state).toBe(S.CLAIM_OPEN);
    expect(store._ledger.get("ord_1")).toBeUndefined();
  });

  it("rejects resolving a claim that is not open", async () => {
    const store = makeStore({
      order: claimOpenOrder(),
      lineItems: twoLineItems,
      claims: [{ ...openClaimSeed(["li_1"]), status: CLAIM_STATUS.RESOLVED }],
    });
    const res = await resolveClaim({
      store, claimId: "claim_1", actor: curatorActor, now: T0 + 5000,
      resolutions: { li_1: { outcome: RESOLUTION_OUTCOME.DENY } },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not open/i);
  });

  it("full refund can be auto-approved by the system actor", async () => {
    const store = makeStore({
      order: claimOpenOrder(),
      lineItems: twoLineItems.map((li) => ({ ...li, state: L.DOA_CLAIMED })),
      claims: [openClaimSeed(["li_1", "li_2"])],
    });
    const res = await resolveClaim({
      store, claimId: "claim_1", actor: { isSystem: true }, now: T0 + 5000,
      resolutions: {
        li_1: { outcome: RESOLUTION_OUTCOME.REFUND, refundCents: 4000 },
        li_2: { outcome: RESOLUTION_OUTCOME.REFUND, refundCents: 2000 },
      },
    });
    expect(res.ok).toBe(true);
    expect(res.orderState).toBe(S.REFUNDED);
  });
});
