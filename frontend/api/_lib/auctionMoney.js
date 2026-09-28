/**
 * auctionMoney.js — what an auction winner is charged, and who gets what
 * (docs/AUCTIONS_SPEC.md §5). Pure: no I/O.
 *
 * The winner pays the hammer price plus the card processing fee (the same
 * gross-up as checkout). The seller's proceeds are the hammer price minus the
 * platform fee (4%, or 2% in event mode). Club splits (phase 4) come out of the
 * seller's side at payout and never change what the winner pays.
 */

import { computeCheckoutCharge } from "../../src/services/checkoutPricing.js";

export const AUCTION_PAYMENT_PURPOSE = "aquadex_auction_lot_v2";
export const CLUB_FEE_SHARE_PERCENT = 25;

/**
 * @param {object} args
 * @param {number} args.hammerCents - the winning bid
 * @param {number} args.feePercent - the resolved platform fee rate
 * @param {number} args.stripeRate
 * @param {number} args.stripeFixedCents
 */
export function planAuctionCharge({ hammerCents, feePercent, stripeRate, stripeFixedCents }) {
  const hammer = Math.round(Number(hammerCents));
  if (!Number.isInteger(hammer) || hammer < 100) throw new Error("planAuctionCharge: invalid hammer price");
  const c = computeCheckoutCharge({
    goodsPriceCents: hammer,
    shippingCents: 0,
    discountCents: 0,
    funding: "seller_funded",
    feePercent,
    stripeRate,
    stripeFixedCents,
  });
  return {
    hammerCents: hammer,
    buyerTotalCents: c.buyerTotalCents,
    processingFeeCents: c.processingFeeCents,
    platformFeeCents: c.platformFeeCents,
    sellerPayoutCents: c.sellerPayoutCents,
  };
}

/**
 * Split for a club auction lot at payout. Seller + club + platform always add up
 * to the hammer price.
 *
 * @param {{ hammerCents:number, platformFeeCents:number, clubSplitPercent:number, clubFeeSharePercent?:number }} args
 */
export function planClubSplit({ hammerCents, platformFeeCents, clubSplitPercent, clubFeeSharePercent = CLUB_FEE_SHARE_PERCENT }) {
  const split = Math.min(100, Math.max(0, Math.round(Number(clubSplitPercent) || 0)));
  // The split is a share of what's left after our fee — otherwise a donated
  // (100%) lot would pay out more than the winning bid.
  const clubSplitCents = Math.round((hammerCents - platformFeeCents) * (split / 100));
  const clubFeeShareCents = Math.round(platformFeeCents * (clubFeeSharePercent / 100));
  const sellerCents = Math.max(0, hammerCents - platformFeeCents - clubSplitCents);
  return {
    sellerCents,
    clubCents: clubSplitCents + clubFeeShareCents,
    platformCents: platformFeeCents - clubFeeShareCents,
  };
}

/**
 * PaymentIntent metadata for a lot charge. The guest-handoff confirm reads
 * sellerPayoutCents / sellerStripeAccountId / transferGroup from here to pay the
 * seller at pickup. `purchaseType: "auction"` keeps the batch card-sale
 * inventory path from running (the lot's stock moved when it was listed).
 */
export function auctionChargeMetadata({ claim, plan, feePolicy, sellerStripeAccountId, transferGroup, eventId = null }) {
  return {
    purpose: AUCTION_PAYMENT_PURPOSE,
    purchaseType: "auction",
    lotId: String(claim.lotId),
    sellerWallet: String(claim.sellerWallet).toLowerCase(),
    winnerWallet: String(claim.winnerWallet).toLowerCase(),
    ...(claim.listingId ? { listingId: String(claim.listingId) } : {}),
    quantity: String(claim.quantity || 1),
    hammerCents: String(plan.hammerCents),
    goodsTotalCents: String(plan.hammerCents),
    feePercent: String(feePolicy.feePercent),
    feeReason: String(feePolicy.reason).slice(0, 100),
    platformFeeCents: String(plan.platformFeeCents),
    sellerPayoutCents: String(plan.sellerPayoutCents),
    processingFeeCents: String(plan.processingFeeCents),
    sellerStripeAccountId: String(sellerStripeAccountId),
    transferGroup: String(transferGroup),
    salesChannel: "online",
    channelSource: "auction",
    ...(eventId ? { eventId: String(eventId) } : {}),
  };
}

/** A decline message the winner can act on. */
export function chargeFailureMessage(err) {
  const code = err?.code || err?.raw?.code;
  if (code === "authentication_required") return "Your bank wants to confirm this payment. Update your card, then tap Pay now.";
  if (code === "card_declined" || code === "insufficient_funds" || code === "expired_card") {
    return `${err?.raw?.message || err.message || "Your card was declined."} Update your card, then tap Pay now.`;
  }
  return err?.raw?.message || err?.message || "The charge didn't go through.";
}
