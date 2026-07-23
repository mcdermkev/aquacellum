/**
 * Unit tests for checkoutPricing.computeCheckoutCharge — the money-critical
 * charge/fee/payout split for marketplace checkout, including the Task 21B
 * promotion-discount split by funding. This is the Tier A review-gate surface:
 * every branch of the discount math is pinned here.
 *
 * Run: npx vitest --run src/__tests__/checkoutPricing.test.js
 */
import { describe, it, expect } from "vitest";
import { computeCheckoutCharge } from "../services/checkoutPricing.js";

describe("computeCheckoutCharge — no discount (legacy parity)", () => {
  it("computes 4% fee, 96% payout, and the grossed-up processing fee", () => {
    const r = computeCheckoutCharge({ goodsPriceCents: 10000, shippingCents: 0 });
    expect(r.discountCents).toBe(0);
    expect(r.platformFeeCents).toBe(400);
    expect(r.sellerPayoutCents).toBe(9600);
    expect(r.totalAmountCents).toBe(10000);
    expect(r.netChargeableCents).toBe(10000);
    // ceil((10000 + 30) / 0.971) = 10330
    expect(r.buyerTotalCents).toBe(10330);
    expect(r.processingFeeCents).toBe(330);
    expect(r.platformGoodsMarginCents).toBe(400);
  });

  it("excludes shipping from the fee/payout base but includes it in the buyer charge", () => {
    const r = computeCheckoutCharge({ goodsPriceCents: 10000, shippingCents: 1000 });
    expect(r.platformFeeCents).toBe(400); // 4% of goods only
    expect(r.sellerPayoutCents).toBe(9600); // 96% of goods only
    expect(r.totalAmountCents).toBe(11000); // goods + shipping
    // ceil((11000 + 30) / 0.971) = 11360
    expect(r.buyerTotalCents).toBe(11360);
  });
});

describe("computeCheckoutCharge — seller_funded discount", () => {
  it("reduces the goods base so BOTH the fee base and the seller payout drop", () => {
    const r = computeCheckoutCharge({
      goodsPriceCents: 10000,
      shippingCents: 1000,
      discountCents: 2000,
      funding: "seller_funded",
    });
    // fee base = 10000 - 2000 = 8000
    expect(r.platformFeeCents).toBe(320);
    expect(r.sellerPayoutCents).toBe(7680);
    // net charge = (10000 + 1000) - 2000 = 9000; ceil((9000+30)/0.971) = 9300
    expect(r.netChargeableCents).toBe(9000);
    expect(r.buyerTotalCents).toBe(9300);
    expect(r.processingFeeCents).toBe(300);
    // seller_funded margin is always exactly the platform fee (never negative)
    expect(r.platformGoodsMarginCents).toBe(320);
    expect(r.platformGoodsMarginCents).toBe(r.platformFeeCents);
  });

  it("seller receives strictly less than the no-discount payout", () => {
    const base = computeCheckoutCharge({ goodsPriceCents: 10000 });
    const disc = computeCheckoutCharge({ goodsPriceCents: 10000, discountCents: 2000, funding: "seller_funded" });
    expect(disc.sellerPayoutCents).toBeLessThan(base.sellerPayoutCents);
  });
});

describe("computeCheckoutCharge — platform_funded discount", () => {
  it("leaves the seller whole (fee + payout on FULL goods) while the buyer pays less", () => {
    const r = computeCheckoutCharge({
      goodsPriceCents: 10000,
      shippingCents: 1000,
      discountCents: 2000,
      funding: "platform_funded",
    });
    // fee + payout unchanged from the no-discount case
    expect(r.platformFeeCents).toBe(400);
    expect(r.sellerPayoutCents).toBe(9600);
    // buyer still pays the discounted amount
    expect(r.netChargeableCents).toBe(9000);
    expect(r.buyerTotalCents).toBe(9300);
  });

  it("keeps the seller payout identical to the no-discount payout", () => {
    const base = computeCheckoutCharge({ goodsPriceCents: 10000 });
    const disc = computeCheckoutCharge({ goodsPriceCents: 10000, discountCents: 2000, funding: "platform_funded" });
    expect(disc.sellerPayoutCents).toBe(base.sellerPayoutCents);
  });

  it("goes net-negative on goods when the discount exceeds the 4% margin (platform funds the perk)", () => {
    const r = computeCheckoutCharge({ goodsPriceCents: 10000, discountCents: 2000, funding: "platform_funded" });
    // margin = (10000 - 2000) - 9600 = -1600
    expect(r.platformGoodsMarginCents).toBe(-1600);
    expect(r.platformGoodsMarginCents).toBeLessThan(0);
  });

  it("stays non-negative when a platform_funded discount is within the 4% margin", () => {
    const r = computeCheckoutCharge({ goodsPriceCents: 10000, discountCents: 300, funding: "platform_funded" });
    // margin = (10000 - 300) - 9600 = 100
    expect(r.platformGoodsMarginCents).toBe(100);
  });
});

describe("computeCheckoutCharge — discount clamping (defense in depth)", () => {
  it("clamps a discount larger than goods down to the goods subtotal (never touches shipping)", () => {
    const r = computeCheckoutCharge({
      goodsPriceCents: 10000,
      shippingCents: 1000,
      discountCents: 15000,
      funding: "seller_funded",
    });
    expect(r.discountCents).toBe(10000); // clamped to goods, not goods+shipping
    // fee base = 0 → no fee, no payout
    expect(r.platformFeeCents).toBe(0);
    expect(r.sellerPayoutCents).toBe(0);
    // buyer still pays the shipping (+ processing on it); goods fully discounted
    expect(r.netChargeableCents).toBe(1000);
  });

  it("treats a negative discount as zero", () => {
    const r = computeCheckoutCharge({ goodsPriceCents: 10000, discountCents: -500 });
    expect(r.discountCents).toBe(0);
    expect(r.sellerPayoutCents).toBe(9600);
  });

  it("never lets the buyer charge go below the shipping-only amount", () => {
    const r = computeCheckoutCharge({ goodsPriceCents: 5000, shippingCents: 800, discountCents: 99999 });
    expect(r.netChargeableCents).toBe(800);
    expect(r.buyerTotalCents).toBeGreaterThanOrEqual(800);
  });
});

describe("computeCheckoutCharge — invariants", () => {
  it("seller_funded margin always equals the platform fee (never negative)", () => {
    for (const goods of [1, 99, 100, 4999, 10000, 123456]) {
      for (const discount of [0, 1, 50, goods - 1, goods]) {
        if (discount < 0) continue;
        const r = computeCheckoutCharge({ goodsPriceCents: goods, discountCents: discount, funding: "seller_funded" });
        expect(r.platformGoodsMarginCents).toBe(r.platformFeeCents);
        expect(r.platformGoodsMarginCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("the buyer is always grossed up above the net chargeable amount (platform never under-collects)", () => {
    for (const goods of [100, 2500, 10000]) {
      for (const funding of ["seller_funded", "platform_funded"]) {
        const r = computeCheckoutCharge({ goodsPriceCents: goods, shippingCents: 500, discountCents: 200, funding });
        expect(r.buyerTotalCents).toBeGreaterThanOrEqual(r.netChargeableCents);
        expect(r.processingFeeCents).toBe(r.buyerTotalCents - r.netChargeableCents);
      }
    }
  });
});
