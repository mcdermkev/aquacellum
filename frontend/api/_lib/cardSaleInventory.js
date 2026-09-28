/**
 * cardSaleInventory.js — decrement the inventory of record when a CARD sale of a
 * batch is paid (Stripe `payment_intent.succeeded`). Tier A: inventory + money.
 *
 * Why: cash sales already decrement `aquadex_listings.quantity_remaining` through
 * `record_inventory_sale`. Card sales did not, so the booth view and the public
 * "X left" kept showing fish that had been paid for, and a cash sale at the booth
 * could sell a fish a card buyer already owned.
 *
 * Idempotent: the sale id is derived from the PaymentIntent (`stripe:<pi>`), and
 * record_inventory_sale is idempotent on it, so Stripe's webhook retries decrement
 * exactly once.
 *
 * Hold hand-off: checkout sizes its stock hold from quantity_remaining (see
 * resolveReservationTargets in api/stripe.js) and reserve_stock counts committed
 * holds against that number. Once the unit is subtracted from quantity_remaining,
 * keeping the committed hold would count the same fish twice — so after a
 * successful decrement the hold is released. Nothing downstream consumes a
 * committed hold (handoff/refund paths do not read it), so releasing is safe.
 * If the decrement fails, the hold is left committed. Note it only blocks OTHER
 * CARD checkouts — booth cash sales don't read holds, so a cash sale can still
 * take the unit. That case surfaces as `oversold`, and guest handoff confirm
 * re-runs this (idempotently) and refuses to release money for an oversold sale.
 *
 * Singles are out of scope: their hold is sized at 1 independent of the column,
 * and the on-chain / release flows own their lifecycle.
 */

export const CARD_SALE_ID_PREFIX = "stripe:";

/**
 * @param {object} args
 * @param {{ rpc: Function }} args.supabase - service-role client
 * @param {object} args.metadata - PaymentIntent metadata stamped at create-checkout
 * @param {string} args.paymentIntentId
 * @param {(metadata: object) => Promise<unknown>} [args.releaseHolds] - releases this checkout's holds
 * @returns {Promise<{ applied: boolean, skipped?: string, quantityRemaining?: number, oversold?: boolean, error?: string, holdsReleased?: boolean }>}
 */
export async function recordCardSaleInventory({ supabase, metadata, paymentIntentId, releaseHolds }) {
  const md = metadata || {};
  if (md.purchaseType !== "batch") return { applied: false, skipped: "not_batch" };
  if (md.listingId == null || String(md.listingId).trim() === "") return { applied: false, skipped: "no_listing" };
  if (!md.sellerWallet) return { applied: false, skipped: "no_seller" };
  if (!paymentIntentId) return { applied: false, skipped: "no_payment_intent" };

  const quantity = Math.max(1, Math.floor(Number(md.quantity) || 1));

  const { data, error } = await supabase.rpc("record_inventory_sale", {
    p_sale_id: `${CARD_SALE_ID_PREFIX}${paymentIntentId}`,
    p_listing_id: String(md.listingId),
    p_quantity: quantity,
    p_seller: String(md.sellerWallet).toLowerCase(),
    p_rail: "card",
    p_order_id: null,
  });

  if (error) {
    const msg = error.message || String(error);
    // A paid order for a fish that is no longer in stock (e.g. sold for cash at
    // the booth in the same minute). Money is captured and held; the seller must
    // resolve it (refund or substitute). Surfaced loudly, never swallowed.
    return { applied: false, oversold: /oversell/i.test(msg), error: msg };
  }

  let holdsReleased = false;
  if (typeof releaseHolds === "function" && md.reservationGroupId) {
    try {
      // releaseCheckoutReservations reports failure as { ok:false }, not a throw.
      const r = await releaseHolds(md);
      holdsReleased = !(r && r.ok === false);
    } catch {
      // Best-effort: a stuck committed hold only under-sells, it cannot oversell.
    }
  }

  return { applied: true, quantityRemaining: Number(data), holdsReleased };
}
