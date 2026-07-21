/**
 * Unit tests for the protected-payment ledger (Task 4).
 *
 * Verifies the charge breakdown math and the event-sourced balances the demo
 * surfaces (payment received, payment protected, refundable balance, seller
 * payout status), plus the required scenarios: full/partial refunds, transfer
 * retries, webhook replay, disputed charges, cancellation, and reconciliation.
 *
 * Run with: npx vitest --run src/__tests__/paymentLedger.test.js
 */

import { describe, it, expect } from "vitest";
import {
  PLATFORM_FEE_PERCENT,
  computeChargeBreakdown,
  LEDGER_ENTRY_TYPES as T,
  PAYOUT_STATUS,
  reduceLedger,
  reconcile,
} from "../services/paymentLedger.js";

describe("computeChargeBreakdown", () => {
  it("splits goods 4% platform / 96% seller and grosses up the Stripe fee (no shipping)", () => {
    const b = computeChargeBreakdown({ goodsCents: 10000 });
    expect(PLATFORM_FEE_PERCENT).toBe(4);
    expect(b.platformFeeCents).toBe(400);
    expect(b.sellerProceedsCents).toBe(9600);
    expect(b.netCents).toBe(10000);
    // gross = ceil((10000 + 30) / (1 - 0.029)) = 10330
    expect(b.grossChargedCents).toBe(10330);
    expect(b.stripeProcessingFeeCents).toBe(330);
    expect(b.platformRevenueCents).toBe(400);
  });

  it("keeps the full shipping fee as platform revenue and nets goods+shipping", () => {
    const b = computeChargeBreakdown({ goodsCents: 10000, shippingFeeCents: 1500 });
    expect(b.sellerProceedsCents).toBe(9600);
    expect(b.platformRevenueCents).toBe(400 + 1500);
    expect(b.netCents).toBe(11500);
    // gross = ceil((11500 + 30) / 0.971) = 11875
    expect(b.grossChargedCents).toBe(11875);
    expect(b.stripeProcessingFeeCents).toBe(375);
  });

  it("subtracts discounts/credits from the net the platform grosses up", () => {
    const b = computeChargeBreakdown({ goodsCents: 10000, discountCents: 1000, creditsCents: 500 });
    expect(b.netCents).toBe(8500);
    expect(b.sellerProceedsCents).toBe(9600); // seller share is off goods, unaffected
  });

  it("rejects invalid goods", () => {
    expect(() => computeChargeBreakdown({ goodsCents: -1 })).toThrow();
  });
});

describe("reduceLedger — happy path (held shipping order)", () => {
  const money = { sellerProceedsCents: 9600, grossChargedCents: 10330 };

  it("before release: full amount protected, nothing paid", () => {
    const bal = reduceLedger(money, [
      { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 },
    ]);
    expect(bal.capturedCents).toBe(10330);
    expect(bal.protectedCents).toBe(9600); // seller proceeds held
    expect(bal.stripeRefundableCents).toBe(10330);
    expect(bal.sellerOwedCents).toBe(9600);
    expect(bal.payoutStatus).toBe(PAYOUT_STATUS.PROTECTED);
  });

  it("after successful payout: seller paid, nothing protected", () => {
    const bal = reduceLedger(money, [
      { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 },
      { type: T.TRANSFER_INITIATED, transferId: "tr_1", amountCents: 9600 },
      { type: T.TRANSFER_SUCCEEDED, id: "trs_1", transferId: "tr_1", amountCents: 9600 },
    ]);
    expect(bal.sellerPaidCents).toBe(9600);
    expect(bal.protectedCents).toBe(0);
    expect(bal.sellerOwedCents).toBe(0);
    expect(bal.transferPendingCents).toBe(0);
    expect(bal.payoutStatus).toBe(PAYOUT_STATUS.PAID);
  });

  it("transfer initiated but not yet confirmed → pending", () => {
    const bal = reduceLedger(money, [
      { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 },
      { type: T.TRANSFER_INITIATED, transferId: "tr_1", amountCents: 9600 },
    ]);
    expect(bal.transferPendingCents).toBe(9600);
    expect(bal.payoutStatus).toBe(PAYOUT_STATUS.PENDING);
  });
});

describe("reduceLedger — webhook replay", () => {
  it("de-duplicates repeated captures/transfers on (type, id)", () => {
    const money = { sellerProceedsCents: 9600 };
    const bal = reduceLedger(money, [
      { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 },
      { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 }, // replay
      { type: T.TRANSFER_SUCCEEDED, id: "trs_1", transferId: "tr_1", amountCents: 9600 },
      { type: T.TRANSFER_SUCCEEDED, id: "trs_1", transferId: "tr_1", amountCents: 9600 }, // replay
    ]);
    expect(bal.capturedCents).toBe(10330);
    expect(bal.sellerPaidCents).toBe(9600);
  });
});

describe("reduceLedger — refunds", () => {
  const money = { sellerProceedsCents: 9600, grossChargedCents: 10330 };

  it("full refund before payout → refunded, seller owed nothing", () => {
    const bal = reduceLedger(money, [
      { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 },
      { type: T.REFUND, id: "re_1", amountCents: 10330, sellerPortionCents: 9600 },
    ]);
    expect(bal.refundedCents).toBe(10330);
    expect(bal.stripeRefundableCents).toBe(0);
    expect(bal.sellerOwedCents).toBe(0);
    expect(bal.protectedCents).toBe(0);
    expect(bal.payoutStatus).toBe(PAYOUT_STATUS.REFUNDED);
  });

  it("partial refund of one fish reduces seller proceeds and protected balance", () => {
    // Refund $30 of a multi-fish order, all from the seller's proceeds.
    const bal = reduceLedger(money, [
      { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 },
      { type: T.REFUND, id: "re_1", amountCents: 3000, sellerPortionCents: 3000 },
    ]);
    expect(bal.refundedCents).toBe(3000);
    expect(bal.sellerOwedCents).toBe(6600); // 9600 - 3000
    expect(bal.protectedCents).toBe(6600);
    expect(bal.payoutStatus).toBe(PAYOUT_STATUS.PROTECTED);
  });

  it("refund after payout produces a seller clawback", () => {
    const bal = reduceLedger(money, [
      { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 },
      { type: T.TRANSFER_SUCCEEDED, id: "trs_1", transferId: "tr_1", amountCents: 9600 },
      { type: T.REFUND, id: "re_1", amountCents: 3000, sellerPortionCents: 3000 },
    ]);
    // Seller should only keep 6600 but was paid 9600 → 3000 clawback.
    expect(bal.sellerClawbackCents).toBe(3000);
  });
});

describe("reduceLedger — transfer retry", () => {
  it("failed transfer then successful retry ends paid", () => {
    const money = { sellerProceedsCents: 9600 };
    const bal = reduceLedger(money, [
      { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 },
      { type: T.TRANSFER_INITIATED, transferId: "tr_1", amountCents: 9600 },
      { type: T.TRANSFER_FAILED, id: "trf_1", transferId: "tr_1", amountCents: 9600 },
      { type: T.TRANSFER_INITIATED, transferId: "tr_2", amountCents: 9600 },
      { type: T.TRANSFER_SUCCEEDED, id: "trs_2", transferId: "tr_2", amountCents: 9600 },
    ]);
    expect(bal.transferFailures).toBe(1);
    expect(bal.transferPendingCents).toBe(0);
    expect(bal.sellerPaidCents).toBe(9600);
    expect(bal.payoutStatus).toBe(PAYOUT_STATUS.PAID);
  });

  it("failed transfer with nothing pending and money still owed → failed_retry", () => {
    const money = { sellerProceedsCents: 9600 };
    const bal = reduceLedger(money, [
      { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 },
      { type: T.TRANSFER_INITIATED, transferId: "tr_1", amountCents: 9600 },
      { type: T.TRANSFER_FAILED, id: "trf_1", transferId: "tr_1", amountCents: 9600 },
    ]);
    expect(bal.payoutStatus).toBe(PAYOUT_STATUS.FAILED_RETRY);
    expect(bal.sellerOwedCents).toBe(9600);
  });
});

describe("reduceLedger — disputes and cancellation", () => {
  const money = { sellerProceedsCents: 9600 };

  it("an open dispute freezes payout", () => {
    const bal = reduceLedger(money, [
      { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 },
      { type: T.DISPUTE_OPENED, id: "dp_1" },
    ]);
    expect(bal.disputeStatus).toBe("open");
    expect(bal.payoutStatus).toBe(PAYOUT_STATUS.FROZEN);
  });

  it("a lost dispute counts the disputed amount as refunded", () => {
    const bal = reduceLedger(money, [
      { type: T.CHARGE_CAPTURED, id: "pi_1", amountCents: 10330 },
      { type: T.DISPUTE_OPENED, id: "dp_1" },
      { type: T.DISPUTE_LOST, id: "dp_1_lost", amountCents: 10330 },
    ]);
    expect(bal.disputeStatus).toBe("lost");
    expect(bal.refundedCents).toBe(10330);
    expect(bal.payoutStatus).toBe(PAYOUT_STATUS.REFUNDED);
  });

  it("cancellation before fulfillment", () => {
    const bal = reduceLedger(money, [
      { type: T.CANCELLED, id: "c_1" },
    ]);
    expect(bal.cancelled).toBe(true);
    expect(bal.payoutStatus).toBe(PAYOUT_STATUS.CANCELLED);
  });
});

describe("reconcile", () => {
  const balances = { capturedCents: 10330, refundedCents: 0, sellerPaidCents: 9600 };

  it("is balanced when Stripe matches", () => {
    const r = reconcile(balances, { capturedCents: 10330, refundedCents: 0, transferredCents: 9600 });
    expect(r.balanced).toBe(true);
    expect(r.discrepancies).toEqual([]);
  });

  it("flags a captured/transferred mismatch with signed deltas", () => {
    const r = reconcile(balances, { capturedCents: 10330, refundedCents: 0, transferredCents: 9000 });
    expect(r.balanced).toBe(false);
    expect(r.discrepancies).toContainEqual({ field: "sellerPaidCents", ledger: 9600, stripe: 9000, deltaCents: 600 });
  });

  it("ignores fields Stripe does not report", () => {
    const r = reconcile(balances, { capturedCents: 10330 });
    expect(r.balanced).toBe(true);
  });
});
