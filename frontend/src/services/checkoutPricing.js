/**
 * checkoutPricing.js
 *
 * Pure checkout charge math for the marketplace's escrow money model, including
 * the Task 21B promotion-discount split by funding. Extracted from
 * api/stripe.js handleCreateCheckout so the money-critical arithmetic is
 * independently unit-testable (Tier A review gate) and can never silently drift.
 *
 * Money model (unchanged by promotions):
 *   • Buyer is charged goods + shipping, grossed up for Stripe's processing fee.
 *   • Funds land in the PLATFORM balance and are HELD; the seller is paid later
 *     via a Stripe Transfer of `sellerPayoutCents`.
 *   • Platform keeps 4% of the goods base + the full shipping fee.
 *
 * Promotion discount (Task 21B) — applies to GOODS ONLY, never shipping/processing:
 *   • seller_funded  → the discount reduces the goods base, so BOTH the 4% fee
 *                      base and the seller's 96% payout drop with it.
 *   • platform_funded→ fee + payout are computed on the FULL goods (seller is
 *                      left whole); the platform absorbs the discount from its
 *                      own margin. If the discount exceeds the 4% goods margin,
 *                      `platformGoodsMarginCents` goes negative — by design, the
 *                      platform is funding the perk. Callers should surface that.
 *
 * All inputs/outputs are integer USD cents. Deterministic; no side effects.
 */

export const DEFAULT_PLATFORM_FEE_PERCENT = 4;
export const DEFAULT_STRIPE_FEE_RATE = 0.029;
export const DEFAULT_STRIPE_FEE_FIXED_CENTS = 30;

/**
 * @param {Object} args
 * @param {number} args.goodsPriceCents  goods subtotal (shipping excluded), cents
 * @param {number} [args.shippingCents=0]
 * @param {number} [args.discountCents=0] candidate goods discount (pre-clamp)
 * @param {('seller_funded'|'platform_funded')} [args.funding='seller_funded']
 * @param {number} [args.feePercent=4]
 * @param {number} [args.stripeRate=0.029]
 * @param {number} [args.stripeFixedCents=30]
 * @returns {{
 *   discountCents:number, totalAmountCents:number, netChargeableCents:number,
 *   platformFeeCents:number, sellerPayoutCents:number, processingFeeCents:number,
 *   buyerTotalCents:number, platformGoodsMarginCents:number
 * }}
 */
export function computeCheckoutCharge({
  goodsPriceCents,
  shippingCents = 0,
  discountCents = 0,
  funding = "seller_funded",
  feePercent = DEFAULT_PLATFORM_FEE_PERCENT,
  stripeRate = DEFAULT_STRIPE_FEE_RATE,
  stripeFixedCents = DEFAULT_STRIPE_FEE_FIXED_CENTS,
}) {
  const goods = Math.max(0, Math.round(Number(goodsPriceCents) || 0));
  const shipping = Math.max(0, Math.round(Number(shippingCents) || 0));

  // A discount can never touch shipping and can never exceed the goods subtotal
  // or go negative. This is defense-in-depth over promotionEngine's own clamp.
  const discount = Math.max(0, Math.min(Math.round(Number(discountCents) || 0), goods));

  const isSellerFunded = funding !== "platform_funded";

  // seller_funded shrinks the goods base (fee + payout both drop); platform_funded
  // keeps the seller whole on the full goods.
  const feeBaseGoodsCents = isSellerFunded ? goods - discount : goods;
  const platformFeeCents = Math.round(feeBaseGoodsCents * (feePercent / 100));
  const sellerPayoutCents = feeBaseGoodsCents - platformFeeCents;

  // Pre-discount goods+shipping — recorded as metadata.goodsTotalCents (the
  // buyer-charged amount BEFORE the coupon reduces it).
  const totalAmountCents = goods + shipping;

  // The coupon (amount_off = discount) reduces the charged total by exactly the
  // discount, so gross up the buyer's Stripe processing fee on the DISCOUNTED
  // chargeable amount to keep the processing line exact. Round UP so the platform
  // never under-collects and dips into its 4%.
  const netChargeableCents = totalAmountCents - discount;
  const buyerTotalCents = Math.ceil((netChargeableCents + stripeFixedCents) / (1 - stripeRate));
  const processingFeeCents = buyerTotalCents - netChargeableCents;

  // What the platform keeps on goods after the discount and the seller payout.
  // Negative ⇒ platform_funded discount exceeding the 4% margin (platform pays
  // out of pocket, by design). Always ≥ 0 for seller_funded.
  const platformGoodsMarginCents = goods - discount - sellerPayoutCents;

  return {
    discountCents: discount,
    totalAmountCents,
    netChargeableCents,
    platformFeeCents,
    sellerPayoutCents,
    processingFeeCents,
    buyerTotalCents,
    platformGoodsMarginCents,
  };
}
