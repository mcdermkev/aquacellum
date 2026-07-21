/**
 * Unit tests for the settlement coordinator (Task 5) — the atomic completion
 * sequence where certificate transfer gates seller payout.
 *
 * Uses injected fake effects to assert ordering and failure handling:
 *   - certificate failure aborts before any payout
 *   - payout failure after a successful certificate transfer never reverses the
 *     certificate and leaves the order retryable
 *   - cash orders skip payout
 *   - re-running after a partial completion resumes correctly
 *
 * Run with: npx vitest --run src/__tests__/settlementCoordinator.test.js
 */

import { describe, it, expect, vi } from "vitest";
import { ORDER_STATES as S, FULFILLMENT_METHODS as M } from "../services/marketplaceStateMachine.js";
import { LEDGER_ENTRY_TYPES as T } from "../services/paymentLedger.js";
import { completeSettlement, SETTLEMENT_ACTIONS as A } from "../services/settlementCoordinator.js";

const systemActor = { isSystem: true };

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

function okEffects() {
  return {
    transferCertificate: vi.fn(async () => ({ ok: true, ref: "cert_ref_1" })),
    initiatePayout: vi.fn(async () => ({ ok: true, transferId: "tr_ok" })),
  };
}

const types = (entries) => entries.map((e) => e.type);

describe("happy paths", () => {
  it("shipping: transfers certificate then pays the seller, then completes", async () => {
    const effects = okEffects();
    const res = await completeSettlement({ order: baseOrder(), actor: systemActor, effects });

    expect(res.ok).toBe(true);
    expect(res.action).toBe(A.COMPLETED);
    expect(res.finalState).toBe(S.COMPLETED);
    expect(res.certificateRef).toBe("cert_ref_1");
    expect(res.transferId).toBe("tr_ok");
    expect(res.xpEligible).toBe(true);
    expect(res.reviewEligible).toBe(true);

    // Ordering: certificate before payout.
    expect(effects.transferCertificate).toHaveBeenCalledTimes(1);
    expect(effects.initiatePayout).toHaveBeenCalledTimes(1);
    expect(effects.initiatePayout).toHaveBeenCalledWith(expect.any(Object), 9600);
    expect(types(res.appendedEntries)).toEqual([
      "certificate_transferred", T.TRANSFER_INITIATED, T.TRANSFER_SUCCEEDED,
    ]);
  });

  it("prepaid pickup: same paid path", async () => {
    const effects = okEffects();
    const res = await completeSettlement({ order: baseOrder({ method: M.PREPAID_PICKUP }), actor: systemActor, effects });
    expect(res.action).toBe(A.COMPLETED);
    expect(effects.initiatePayout).toHaveBeenCalledTimes(1);
  });

  it("cash: transfers certificate and completes WITHOUT any payout", async () => {
    const effects = okEffects();
    const res = await completeSettlement({ order: baseOrder({ method: M.CASH_PICKUP }), actor: systemActor, effects });

    expect(res.ok).toBe(true);
    expect(res.action).toBe(A.COMPLETED_CASH);
    expect(res.finalState).toBe(S.COMPLETED);
    expect(effects.transferCertificate).toHaveBeenCalledTimes(1);
    expect(effects.initiatePayout).not.toHaveBeenCalled();
  });
});

describe("failure handling", () => {
  it("certificate failure aborts before any payout and leaves state unchanged", async () => {
    const effects = {
      transferCertificate: vi.fn(async () => ({ ok: false, error: "chain revert" })),
      initiatePayout: vi.fn(async () => ({ ok: true })),
    };
    const res = await completeSettlement({ order: baseOrder(), actor: systemActor, effects });

    expect(res.ok).toBe(false);
    expect(res.action).toBe(A.CERTIFICATE_FAILED);
    expect(res.finalState).toBe(S.HANDOFF_CONFIRMED); // unchanged, retryable
    expect(res.error).toMatch(/chain revert/);
    expect(effects.initiatePayout).not.toHaveBeenCalled();
    expect(res.appendedEntries).toEqual([]);
  });

  it("payout failure after certificate keeps the certificate and marks retry", async () => {
    const effects = {
      transferCertificate: vi.fn(async () => ({ ok: true, ref: "cert_ref_1" })),
      initiatePayout: vi.fn(async () => ({ ok: false, error: "stripe 500" })),
    };
    const res = await completeSettlement({ order: baseOrder(), actor: systemActor, effects });

    expect(res.ok).toBe(false);
    expect(res.action).toBe(A.PAYOUT_PENDING_RETRY);
    expect(res.finalState).toBe(S.CERTIFICATE_TRANSFERRED); // certificate NOT reversed
    expect(res.certificateRef).toBe("cert_ref_1");
    expect(types(res.appendedEntries)).toEqual([
      "certificate_transferred", T.TRANSFER_INITIATED, T.TRANSFER_FAILED,
    ]);
  });

  it("a thrown certificate effect is treated as failure, not a crash", async () => {
    const effects = {
      transferCertificate: vi.fn(async () => { throw new Error("boom"); }),
      initiatePayout: vi.fn(),
    };
    const res = await completeSettlement({ order: baseOrder(), actor: systemActor, effects });
    expect(res.action).toBe(A.CERTIFICATE_FAILED);
    expect(res.error).toMatch(/boom/);
  });
});

describe("idempotent resume", () => {
  it("resumes at payout when the certificate is already transferred", async () => {
    const effects = okEffects();
    const res = await completeSettlement({
      order: baseOrder({ state: S.CERTIFICATE_TRANSFERRED }),
      actor: systemActor,
      effects,
    });
    expect(res.ok).toBe(true);
    expect(res.action).toBe(A.COMPLETED);
    expect(effects.transferCertificate).not.toHaveBeenCalled(); // not re-transferred
    expect(effects.initiatePayout).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when already completed", async () => {
    const effects = okEffects();
    const res = await completeSettlement({ order: baseOrder({ state: S.COMPLETED }), actor: systemActor, effects });
    expect(res.action).toBe(A.ALREADY_COMPLETE);
    expect(effects.transferCertificate).not.toHaveBeenCalled();
    expect(effects.initiatePayout).not.toHaveBeenCalled();
  });
});

describe("guards", () => {
  it("blocks when there is an open claim", async () => {
    const effects = okEffects();
    const res = await completeSettlement({ order: baseOrder({ hasOpenClaim: true }), actor: systemActor, effects });
    expect(res.action).toBe(A.BLOCKED_CLAIM);
    expect(effects.transferCertificate).not.toHaveBeenCalled();
  });

  it("blocks when the ledger shows an open dispute", async () => {
    const effects = okEffects();
    const res = await completeSettlement({
      order: baseOrder(),
      actor: systemActor,
      ledgerEntries: [{ type: T.DISPUTE_OPENED, id: "dp_1" }],
      effects,
    });
    expect(res.action).toBe(A.BLOCKED_CLAIM);
  });

  it("rejects a non-system actor", async () => {
    const effects = okEffects();
    const res = await completeSettlement({ order: baseOrder(), actor: { walletAddress: "0xbuyer" }, effects });
    expect(res.action).toBe(A.UNAUTHORIZED);
    expect(effects.transferCertificate).not.toHaveBeenCalled();
  });

  it("rejects an ineligible state", async () => {
    const effects = okEffects();
    const res = await completeSettlement({ order: baseOrder({ state: S.PREPARING }), actor: systemActor, effects });
    expect(res.action).toBe(A.NOT_ELIGIBLE);
  });
});

describe("partial DOA resolution", () => {
  it("pays only the remaining (healthy) proceeds after a partial refund", async () => {
    const effects = okEffects();
    const res = await completeSettlement({
      order: baseOrder({ state: S.PARTIALLY_RESOLVED }),
      actor: systemActor,
      // one fish refunded ($30 of the seller's proceeds)
      ledgerEntries: [
        { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 },
        { type: T.REFUND, id: "re_1", amountCents: 3000, sellerPortionCents: 3000 },
      ],
      effects,
    });
    expect(res.action).toBe(A.COMPLETED);
    expect(effects.initiatePayout).toHaveBeenCalledWith(expect.any(Object), 6600); // 9600 - 3000
  });

  it("completes without payout when the healthy set owes nothing", async () => {
    const effects = okEffects();
    const res = await completeSettlement({
      order: baseOrder({ state: S.PARTIALLY_RESOLVED }),
      actor: systemActor,
      ledgerEntries: [
        { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 },
        { type: T.REFUND, id: "re_1", amountCents: 9600, sellerPortionCents: 9600 },
      ],
      effects,
    });
    expect(res.action).toBe(A.COMPLETED_NO_PAYOUT);
    expect(effects.transferCertificate).toHaveBeenCalledTimes(1);
    expect(effects.initiatePayout).not.toHaveBeenCalled();
  });
});
