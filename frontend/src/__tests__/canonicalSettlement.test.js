/**
 * Unit tests for the canonical settlement bridge (feature-flagged release-v2).
 *
 * Covers the pure mappers, the effect builder (with injected fake chain/Stripe
 * primitives), and the ensure-order-then-settle orchestration against an
 * in-memory store. The real end-to-end path is verified live behind the flag.
 *
 * Run with: npx vitest --run src/__tests__/canonicalSettlement.test.js
 */

import { describe, it, expect, vi } from "vitest";
import { ORDER_STATES as S } from "../services/marketplaceStateMachine.js";
import {
  mapPurchaseTypeToMethod,
  mapPIToCanonicalOrder,
  buildSettlementEffects,
  settleViaCanonical,
  recordCanonicalOrderProtected,
} from "../../api/_lib/canonicalSettlement.js";

const fakeTx = (hash) => ({ wait: async () => ({ transactionHash: hash }) });

describe("mapPurchaseTypeToMethod", () => {
  it("maps pickup to prepaid_pickup and everything else to shipping", () => {
    expect(mapPurchaseTypeToMethod("pickup")).toBe("prepaid_pickup");
    expect(mapPurchaseTypeToMethod("shipping")).toBe("shipping");
    expect(mapPurchaseTypeToMethod("batch")).toBe("shipping");
    expect(mapPurchaseTypeToMethod("multi")).toBe("shipping");
  });
});

describe("mapPIToCanonicalOrder", () => {
  it("maps metadata to a canonical order row, lowercasing wallets, seeded at handoff_confirmed", () => {
    const row = mapPIToCanonicalOrder({
      metadata: {
        buyerUserId: "did:privy:b", buyerWallet: "0xBUYER", sellerWallet: "0xSELLER",
        purchaseType: "shipping", sellerPayoutCents: 9600, grossChargedCents: 10330, tokenId: 5,
      },
      paymentIntentId: "pi_1",
      paymentHash: "0xhash",
    });
    expect(row).toMatchObject({
      buyer_user_id: "did:privy:b",
      buyer_wallet: "0xbuyer",
      seller_wallet: "0xseller",
      method: "shipping",
      state: S.HANDOFF_CONFIRMED,
      seller_proceeds_cents: 9600,
      gross_charged_cents: 10330,
      stripe_payment_intent: "pi_1",
      stripe_payment_hash: "0xhash",
    });
  });
});

describe("buildSettlementEffects", () => {
  const baseDeps = (marketplace, transferToSeller) => ({
    marketplace,
    transferToSeller,
    metadata: { purchaseType: "shipping", sellerStripeAccountId: "acct_1", transferGroup: "tg" },
    tokenId: 5,
    paymentIntentId: "pi_1",
    paymentHash: "0xhash",
  });

  it("transferCertificate calls the shipping release and returns the tx hash", async () => {
    const marketplace = { releaseFiatShippingEscrow: vi.fn(async () => fakeTx("0xcert")) };
    const { transferCertificate } = buildSettlementEffects(baseDeps(marketplace, vi.fn()));
    const res = await transferCertificate();
    expect(marketplace.releaseFiatShippingEscrow).toHaveBeenCalledWith(5);
    expect(res).toEqual({ ok: true, ref: "0xcert" });
  });

  it("transferCertificate uses purchaseSpecimenFiat for pickup", async () => {
    const marketplace = { purchaseSpecimenFiat: vi.fn(async () => fakeTx("0xpick")) };
    const deps = baseDeps(marketplace, vi.fn());
    deps.metadata = { ...deps.metadata, purchaseType: "pickup", buyerWallet: "0xbuyer", goodsTotalCents: 9600 };
    const { transferCertificate } = buildSettlementEffects(deps);
    const res = await transferCertificate();
    expect(marketplace.purchaseSpecimenFiat).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });

  it("transferCertificate returns ok:false when the chain call throws", async () => {
    const marketplace = { releaseFiatShippingEscrow: vi.fn(async () => { throw new Error("revert"); }) };
    const { transferCertificate } = buildSettlementEffects(baseDeps(marketplace, vi.fn()));
    const res = await transferCertificate();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/revert/);
  });

  it("initiatePayout calls transferToSeller with the amount and returns the transfer id", async () => {
    const transferToSeller = vi.fn(async () => ({ id: "tr_1" }));
    const { initiatePayout } = buildSettlementEffects(baseDeps({}, transferToSeller));
    const res = await initiatePayout({}, 9600);
    expect(transferToSeller).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 9600, sellerStripeAccountId: "acct_1" }));
    expect(res).toEqual({ ok: true, transferId: "tr_1" });
  });

  it("initiatePayout returns ok:false when Stripe throws", async () => {
    const transferToSeller = vi.fn(async () => { throw new Error("stripe down"); });
    const { initiatePayout } = buildSettlementEffects(baseDeps({}, transferToSeller));
    const res = await initiatePayout({}, 9600);
    expect(res.ok).toBe(false);
  });
});

/** In-memory store implementing the extended port. */
function makeStore() {
  const orders = new Map();
  const ledger = new Map();
  const transitions = [];
  let seq = 0;
  return {
    _orders: orders,
    async getOrder(id) { return orders.has(id) ? { ...orders.get(id) } : null; },
    async getOrderByPaymentIntent(pi) {
      for (const o of orders.values()) if (o.stripe_payment_intent === pi) return { ...o, id: o.id };
      return null;
    },
    async createOrder(row) {
      const id = `ord_${++seq}`;
      orders.set(id, {
        id,
        state: row.state,
        method: row.method,
        buyerUserId: row.buyer_user_id,
        buyerWallet: row.buyer_wallet,
        sellerWallet: row.seller_wallet,
        sellerProceedsCents: row.seller_proceeds_cents,
        stripe_payment_intent: row.stripe_payment_intent,
      });
      ledger.set(id, []);
      return id;
    },
    async getLedgerEntries(id) { return [...(ledger.get(id) || [])]; },
    async findTransition() { return null; },
    async appendLedgerEntries(id, entries) {
      const list = ledger.get(id) || [];
      for (const e of entries) {
        if (e.id != null && list.some((x) => x.type === e.type && x.id === e.id)) continue;
        list.push(e);
      }
      ledger.set(id, list);
    },
    async setOrderState(id, state, patch = {}) { orders.set(id, { ...orders.get(id), state, ...patch }); },
    async recordTransition(row) { transitions.push(row); },
  };
}

describe("settleViaCanonical", () => {
  const metadata = {
    purchaseType: "shipping", buyerWallet: "0xbuyer", sellerWallet: "0xseller",
    sellerPayoutCents: 9600, sellerStripeAccountId: "acct_1", transferGroup: "tg",
  };

  it("creates the canonical order and completes settlement (cert + payout)", async () => {
    const store = makeStore();
    const marketplace = { releaseFiatShippingEscrow: vi.fn(async () => fakeTx("0xcert")) };
    const transferToSeller = vi.fn(async () => ({ id: "tr_1" }));

    const res = await settleViaCanonical({
      store, marketplace, transferToSeller,
      paymentIntentId: "pi_1", metadata, tokenId: 5, paymentHash: "0xhash", capturedCents: 10330,
    });

    expect(res.ok).toBe(true);
    expect(res.finalState).toBe(S.COMPLETED);
    expect(marketplace.releaseFiatShippingEscrow).toHaveBeenCalledWith(5);
    expect(transferToSeller).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 9600 }));
    expect(store._orders.size).toBe(1);
  });

  it("does not create a duplicate order when one already exists for the PI", async () => {
    const store = makeStore();
    await store.createOrder(mapPIToCanonicalOrder({ metadata, paymentIntentId: "pi_1", paymentHash: "0xhash" }));
    const marketplace = { releaseFiatShippingEscrow: vi.fn(async () => fakeTx("0xcert")) };
    const transferToSeller = vi.fn(async () => ({ id: "tr_1" }));

    await settleViaCanonical({
      store, marketplace, transferToSeller,
      paymentIntentId: "pi_1", metadata, tokenId: 5, paymentHash: "0xhash",
    });
    expect(store._orders.size).toBe(1);
  });

  it("payout failure leaves the order at certificate_transferred (certificate not reversed)", async () => {
    const store = makeStore();
    const marketplace = { releaseFiatShippingEscrow: vi.fn(async () => fakeTx("0xcert")) };
    const transferToSeller = vi.fn(async () => { throw new Error("stripe down"); });

    const res = await settleViaCanonical({
      store, marketplace, transferToSeller,
      paymentIntentId: "pi_1", metadata, tokenId: 5, paymentHash: "0xhash",
    });
    expect(res.ok).toBe(false);
    expect(res.action).toBe("payout_pending_retry");
    expect(res.finalState).toBe(S.CERTIFICATE_TRANSFERRED);
  });
});

describe("recordCanonicalOrderProtected", () => {
  const metadata = { purchaseType: "shipping", buyerWallet: "0xbuyer", sellerWallet: "0xseller", sellerPayoutCents: 9600 };

  it("creates the order at payment_protected with a charge_captured ledger entry", async () => {
    const store = makeStore();
    const res = await recordCanonicalOrderProtected({ store, paymentIntentId: "pi_9", metadata, paymentHash: "0xh", capturedCents: 10330 });
    expect(res.created).toBe(true);
    const o = await store.getOrderByPaymentIntent("pi_9");
    expect(o.state).toBe(S.PAYMENT_PROTECTED);
    const entries = await store.getLedgerEntries(o.id);
    expect(entries.map((e) => e.type)).toContain("charge_captured");
  });

  it("is idempotent for an existing PaymentIntent", async () => {
    const store = makeStore();
    await recordCanonicalOrderProtected({ store, paymentIntentId: "pi_9", metadata, paymentHash: "0xh", capturedCents: 10330 });
    const second = await recordCanonicalOrderProtected({ store, paymentIntentId: "pi_9", metadata, paymentHash: "0xh", capturedCents: 10330 });
    expect(second.created).toBe(false);
    expect(store._orders.size).toBe(1);
  });
});
