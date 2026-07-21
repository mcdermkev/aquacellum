/**
 * Unit tests for orderService (the wiring layer) using an in-memory store.
 *
 * Proves that the persisted operations behave correctly without a database:
 * authorized/idempotent transitions, ledger de-duplication, and settlement
 * persistence including the payout-pending resume path.
 *
 * Run with: npx vitest --run src/__tests__/orderService.test.js
 */

import { describe, it, expect, vi } from "vitest";
import { ORDER_STATES as S, FULFILLMENT_METHODS as M } from "../services/marketplaceStateMachine.js";
import { LEDGER_ENTRY_TYPES as T } from "../services/paymentLedger.js";
import { applyTransition, runSettlement } from "../services/orderService.js";

/** Minimal in-memory implementation of the store port. */
function makeStore(order) {
  const orders = new Map();
  const ledger = new Map(); // orderId → entries[]
  const transitions = []; // {orderId, idempotencyKey, ...}
  orders.set(order.id, { ...order });
  ledger.set(order.id, []);

  return {
    _orders: orders,
    _ledger: ledger,
    _transitions: transitions,
    async getOrder(id) { return orders.has(id) ? { ...orders.get(id) } : null; },
    async getLedgerEntries(id) { return [...(ledger.get(id) || [])]; },
    async findTransition(id, key) {
      return transitions.find((t) => t.orderId === id && t.idempotencyKey === key) || null;
    },
    async appendLedgerEntries(id, entries) {
      const list = ledger.get(id) || [];
      for (const e of entries) {
        // Emulate the DB unique(order_id, entry_type, entry_id) dedupe.
        const dup = e.id != null && list.some((x) => x.type === e.type && x.id === e.id);
        if (!dup) list.push(e);
      }
      ledger.set(id, list);
    },
    async setOrderState(id, state, patch = {}) {
      orders.set(id, { ...orders.get(id), state, ...patch });
    },
    async recordTransition(row) { transitions.push(row); },
  };
}

const systemActor = { isSystem: true };
const buyerActor = { userId: "did:privy:buyer" };

function baseOrder(overrides = {}) {
  return {
    id: "ord_1",
    state: S.HANDOFF_CONFIRMED,
    method: M.SHIPPING,
    buyerUserId: "did:privy:buyer",
    buyerWallet: "0xbuyer",
    sellerWallet: "0xseller",
    sellerProceedsCents: 9600,
    ...overrides,
  };
}

describe("applyTransition", () => {
  it("applies an authorized transition and records it", async () => {
    const store = makeStore(baseOrder({ state: S.DELIVERED }));
    const res = await applyTransition({
      store, orderId: "ord_1", to: S.HANDOFF_CONFIRMED, actor: buyerActor,
      idempotencyKey: "k1", reason: "buyer confirmed arrival",
    });
    expect(res.ok).toBe(true);
    expect(res.state).toBe(S.HANDOFF_CONFIRMED);
    expect((await store.getOrder("ord_1")).state).toBe(S.HANDOFF_CONFIRMED);
    expect(store._transitions).toHaveLength(1);
  });

  it("is idempotent: replaying the same key does not re-apply", async () => {
    const store = makeStore(baseOrder({ state: S.DELIVERED }));
    await applyTransition({ store, orderId: "ord_1", to: S.HANDOFF_CONFIRMED, actor: buyerActor, idempotencyKey: "k1" });
    const again = await applyTransition({ store, orderId: "ord_1", to: S.HANDOFF_CONFIRMED, actor: buyerActor, idempotencyKey: "k1" });
    expect(again.idempotent).toBe(true);
    expect(store._transitions).toHaveLength(1);
  });

  it("rejects an unauthorized actor and persists nothing", async () => {
    const store = makeStore(baseOrder({ state: S.DELIVERED }));
    const res = await applyTransition({
      store, orderId: "ord_1", to: S.HANDOFF_CONFIRMED,
      actor: { walletAddress: "0xseller" }, idempotencyKey: "k1",
    });
    expect(res.ok).toBe(false);
    expect(store._transitions).toHaveLength(0);
    expect((await store.getOrder("ord_1")).state).toBe(S.DELIVERED);
  });

  it("returns not found for a missing order", async () => {
    const store = makeStore(baseOrder());
    const res = await applyTransition({ store, orderId: "nope", to: S.COMPLETED, actor: systemActor, idempotencyKey: "k" });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/not found/);
  });
});

describe("runSettlement", () => {
  it("persists the full completion: state completed + ledger entries + certificate ref", async () => {
    const store = makeStore(baseOrder());
    const effects = {
      transferCertificate: vi.fn(async () => ({ ok: true, ref: "cert_1" })),
      initiatePayout: vi.fn(async () => ({ ok: true, transferId: "tr_1" })),
    };
    const res = await runSettlement({ store, orderId: "ord_1", actor: systemActor, effects });

    expect(res.ok).toBe(true);
    expect(res.persisted).toBe(true);
    const saved = await store.getOrder("ord_1");
    expect(saved.state).toBe(S.COMPLETED);
    expect(saved.certificate_ref).toBe("cert_1");
    const entries = await store.getLedgerEntries("ord_1");
    expect(entries.map((e) => e.type)).toEqual([
      "certificate_transferred", T.TRANSFER_INITIATED, T.TRANSFER_SUCCEEDED,
    ]);
  });

  it("payout failure persists the certificate transfer and parks at certificate_transferred", async () => {
    const store = makeStore(baseOrder());
    const effects = {
      transferCertificate: vi.fn(async () => ({ ok: true, ref: "cert_1" })),
      initiatePayout: vi.fn(async () => ({ ok: false, error: "stripe down" })),
    };
    const res = await runSettlement({ store, orderId: "ord_1", actor: systemActor, effects });

    expect(res.ok).toBe(false);
    expect(res.action).toBe("payout_pending_retry");
    const saved = await store.getOrder("ord_1");
    expect(saved.state).toBe(S.CERTIFICATE_TRANSFERRED); // not reversed
    expect(saved.certificate_ref).toBe("cert_1");
  });

  it("resumes from certificate_transferred without re-transferring the certificate", async () => {
    const store = makeStore(baseOrder({ state: S.CERTIFICATE_TRANSFERRED }));
    const effects = {
      transferCertificate: vi.fn(async () => ({ ok: true, ref: "should_not_run" })),
      initiatePayout: vi.fn(async () => ({ ok: true, transferId: "tr_2" })),
    };
    const res = await runSettlement({ store, orderId: "ord_1", actor: systemActor, effects });

    expect(res.ok).toBe(true);
    expect(effects.transferCertificate).not.toHaveBeenCalled();
    expect((await store.getOrder("ord_1")).state).toBe(S.COMPLETED);
  });

  it("certificate failure persists nothing and leaves state unchanged", async () => {
    const store = makeStore(baseOrder());
    const effects = {
      transferCertificate: vi.fn(async () => ({ ok: false, error: "revert" })),
      initiatePayout: vi.fn(),
    };
    const res = await runSettlement({ store, orderId: "ord_1", actor: systemActor, effects });

    expect(res.action).toBe("certificate_failed");
    expect((await store.getOrder("ord_1")).state).toBe(S.HANDOFF_CONFIRMED);
    expect(await store.getLedgerEntries("ord_1")).toEqual([]);
    expect(store._transitions).toHaveLength(0);
  });
});
