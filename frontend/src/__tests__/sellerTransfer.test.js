/**
 * Seller payouts must be funded from the buyer's own charge.
 *
 * Separate charges + transfers: a fresh card charge is PENDING in the platform
 * balance for days, and a plain transfer draws on AVAILABLE balance — so a
 * same-day booth handoff release failed with "insufficient available funds"
 * whenever the platform had no older settled money (it had $0 on 2026-09-26).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { createSellerTransfer } from "../../api/_lib/sellerTransfer.js";

function fakeStripe({ latestCharge = "ch_123", retrieveThrows = false } = {}) {
  return {
    paymentIntents: {
      retrieve: vi.fn(async () => {
        if (retrieveThrows) throw new Error("stripe down");
        return { id: "pi_1", latest_charge: latestCharge };
      }),
    },
    transfers: { create: vi.fn(async (args) => ({ id: "tr_1", ...args })) },
  };
}

const BASE = { sellerStripeAccountId: "acct_seller", amountCents: 961, transferGroup: "grp_1", reference: "pi_1" };

describe("createSellerTransfer", () => {
  it("funds the transfer from the PaymentIntent's charge", async () => {
    const stripe = fakeStripe();
    await createSellerTransfer(stripe, BASE);
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_1");
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      {
        amount: 961,
        currency: "usd",
        destination: "acct_seller",
        source_transaction: "ch_123",
        transfer_group: "grp_1",
        metadata: { reference: "pi_1" },
      },
      { idempotencyKey: "payout:pi_1" }
    );
  });

  it("uses one idempotency key per PaymentIntent, so a double release can't pay twice", async () => {
    const stripe = fakeStripe();
    await createSellerTransfer(stripe, BASE);
    await createSellerTransfer(stripe, BASE);
    const keys = stripe.transfers.create.mock.calls.map((c) => c[1]?.idempotencyKey);
    expect(keys).toEqual(["payout:pi_1", "payout:pi_1"]);
  });

  it("accepts an expanded latest_charge object", async () => {
    const stripe = fakeStripe({ latestCharge: { id: "ch_obj" } });
    await createSellerTransfer(stripe, BASE);
    expect(stripe.transfers.create.mock.calls[0][0].source_transaction).toBe("ch_obj");
  });

  it("uses an explicit charge id without a lookup", async () => {
    const stripe = fakeStripe();
    await createSellerTransfer(stripe, { ...BASE, sourceChargeId: "ch_direct" });
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(stripe.transfers.create.mock.calls[0][0].source_transaction).toBe("ch_direct");
  });

  it("still pays the seller from available balance if the charge can't be resolved", async () => {
    const stripe = fakeStripe({ retrieveThrows: true });
    await createSellerTransfer(stripe, BASE);
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.create.mock.calls[0][0]).not.toHaveProperty("source_transaction");
  });

  it("refuses bad inputs before calling Stripe", async () => {
    const stripe = fakeStripe();
    await expect(createSellerTransfer(stripe, { ...BASE, sellerStripeAccountId: "" })).rejects.toThrow(/seller Stripe account/);
    await expect(createSellerTransfer(stripe, { ...BASE, amountCents: 0 })).rejects.toThrow(/payout amount/);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
});

describe("api/stripe.js uses it for every seller payout", () => {
  const SRC = readFileSync(fileURLToPath(new URL("../../api/stripe.js", import.meta.url)), "utf8");
  it("routes transferToSeller through createSellerTransfer and has no bare transfers.create", () => {
    expect(SRC).toMatch(/async function transferToSeller\(args\) \{[\s\S]{0,300}createSellerTransfer\(stripe, args\)/);
    expect(SRC).not.toMatch(/stripe\.transfers\.create\(/);
  });
});
