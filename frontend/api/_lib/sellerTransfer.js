/**
 * sellerTransfer.js — pay a seller's connected account from a buyer's charge.
 * Tier A: money path.
 *
 * WHY source_transaction: this platform uses separate charges and transfers, and
 * funds from a new card charge sit in the platform balance as PENDING for days
 * (live and test mode alike). A plain `transfers.create` draws on the AVAILABLE
 * balance, so releasing a same-day booth/pickup handoff failed with "insufficient
 * available funds" whenever the platform had no older settled balance — which,
 * on 2026-09-26, it did not ($0 available). Linking the transfer to the charge it
 * is paid from (`source_transaction`) lets Stripe fund it from that charge even
 * while pending, and it can never exceed what that charge brought in.
 *
 * Every caller passes the PaymentIntent id as `reference`; the charge is resolved
 * from it. If that lookup fails, the transfer falls back to the previous
 * behaviour (available balance) rather than not paying the seller.
 */

/**
 * @param {import('stripe').Stripe} stripe
 * @param {{ sellerStripeAccountId: string, amountCents: number, transferGroup?: string, reference?: string, sourceChargeId?: string }} args
 */
export async function createSellerTransfer(stripe, { sellerStripeAccountId, amountCents, transferGroup, reference, sourceChargeId }) {
  if (!sellerStripeAccountId) throw new Error("Missing seller Stripe account");
  if (!amountCents || amountCents <= 0) throw new Error("Invalid seller payout amount");

  let source = typeof sourceChargeId === "string" && sourceChargeId.startsWith("ch_") ? sourceChargeId : null;
  if (!source && typeof reference === "string" && reference.startsWith("pi_")) {
    try {
      const pi = await stripe.paymentIntents.retrieve(reference);
      const charge = pi?.latest_charge;
      source = typeof charge === "string" ? charge : charge?.id || null;
    } catch (err) {
      console.warn("[Seller Transfer] could not resolve source charge; using available balance:", err?.message || err);
    }
  }

  // One payout per PaymentIntent. The idempotency key makes a double-submitted
  // release (two taps, a retry) return the SAME transfer instead of paying twice.
  const options = typeof reference === "string" && reference ? { idempotencyKey: `payout:${reference}` } : undefined;
  return stripe.transfers.create({
    amount: amountCents,
    currency: "usd",
    destination: sellerStripeAccountId,
    ...(source ? { source_transaction: source } : {}),
    ...(transferGroup ? { transfer_group: transferGroup } : {}),
    metadata: { reference: reference || "" },
  }, options);
}
