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

// ─── Refunds ────────────────────────────────────────────────────────────────

export const RESTOCK_ID_PREFIX = "restock:";

/**
 * Order statuses meaning the fish never left the seller. Only these restock on a
 * refund. Anything else — handed off (`released`/`completed`), shipped, disputed,
 * unknown — keeps the stock as is: putting back a fish that's gone creates a
 * phantom that can be sold twice, while missing a restock only under-sells and
 * the seller fixes it with +.
 */
const NOT_HANDED_OFF = new Set(["locked", "pending"]);

/**
 * Pure: should this refund put stock back?
 * @param {{ fullyRefunded: boolean, orderStatus: string|null|undefined }} args
 * @returns {{ restock: boolean, reason?: string }}
 */
export function refundRestockDecision({ fullyRefunded, orderStatus }) {
  if (!fullyRefunded) return { restock: false, reason: "partial_refund" };
  if (orderStatus == null) return { restock: false, reason: "no_order" };
  if (!NOT_HANDED_OFF.has(String(orderStatus))) return { restock: false, reason: `order_${orderStatus}` };
  return { restock: true };
}

/**
 * Put a refunded card sale's fish back in stock, exactly once
 * (`restock_card_sale` is idempotent on the PaymentIntent).
 *
 * @param {object} args
 * @param {{ rpc: Function }} args.supabase - service-role client
 * @param {string} args.paymentIntentId
 * @param {boolean} args.fullyRefunded - Stripe charge.refunded (true only for a full refund)
 * @param {string|null} args.orderStatus - the order row's status before this refund
 * @returns {Promise<{ applied: boolean, skipped?: string, quantityRemaining?: number, error?: string }>}
 */
export async function restockRefundedCardSale({ supabase, paymentIntentId, fullyRefunded, orderStatus }) {
  if (!paymentIntentId) return { applied: false, skipped: "no_payment_intent" };
  const decision = refundRestockDecision({ fullyRefunded, orderStatus });
  if (!decision.restock) return { applied: false, skipped: decision.reason };

  const { data, error } = await supabase.rpc("restock_card_sale", { p_payment_intent: paymentIntentId });
  if (error) return { applied: false, error: error.message || String(error) };
  // NULL: nothing was decremented for this payment (e.g. it was oversold).
  if (data == null) return { applied: false, skipped: "no_card_decrement" };
  return { applied: true, quantityRemaining: Number(data) };
}
