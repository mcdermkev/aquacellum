/**
 * paymentLedger.js
 *
 * The protected-payment ledger (Task 4). Tracks — per order, in integer USD
 * cents — what Stripe has collected, what remains protected (held in the
 * platform balance), what has been refunded, and what is owed to / paid out to
 * the seller. It is the accounting source of truth that reconciles against
 * Stripe webhooks.
 *
 * Money model (matches the current checkout in api/stripe.js):
 *   - Platform keeps 4% of the goods price (matches on-chain TOTAL_FEE_BPS=400)
 *     plus the full shipping fee (it buys the label centrally).
 *   - Seller receives 96% of the goods price, paid via a Stripe transfer AFTER
 *     the certificate transfers (held orders) — see MARKETPLACE_STATE_MODEL.md.
 *   - The buyer pays a grossed-up Stripe processing fee as its own line item so
 *     the platform nets goods + shipping.
 *
 * Pure and dependency-free: it computes breakdowns and folds a sequence of
 * ledger events into balances. It does not call Stripe or persist anything.
 * Webhook replay is handled by de-duplicating entries on (type, id).
 */

// ─── Fee constants (mirror api/stripe.js) ───────────────────────────────────

export const PLATFORM_FEE_PERCENT = 4; // % of goods; matches on-chain TOTAL_FEE_BPS=400
export const STRIPE_FEE_RATE = 0.029; // 2.9%
export const STRIPE_FEE_FIXED_CENTS = 30; // $0.30

const roundCents = (n) => Math.round(n);

/**
 * Compute the canonical money breakdown for a checkout, in cents. This is the
 * formula the checkout should use; the ledger treats Stripe's reported captured
 * amount as authoritative and uses this for validation/reconciliation.
 *
 * @param {{ goodsCents:number, shippingFeeCents?:number, discountCents?:number, creditsCents?:number }} args
 * @returns {{
 *   goodsCents:number, shippingFeeCents:number, discountCents:number, creditsCents:number,
 *   platformFeeCents:number, sellerProceedsCents:number, platformRevenueCents:number,
 *   netCents:number, stripeProcessingFeeCents:number, grossChargedCents:number
 * }}
 */
export function computeChargeBreakdown({ goodsCents, shippingFeeCents = 0, discountCents = 0, creditsCents = 0 }) {
  if (!Number.isFinite(goodsCents) || goodsCents < 0) {
    throw new Error("goodsCents must be a non-negative number");
  }
  const platformFeeCents = roundCents((goodsCents * PLATFORM_FEE_PERCENT) / 100);
  const sellerProceedsCents = goodsCents - platformFeeCents;

  // Net the platform intends to keep before Stripe's cut (goods + shipping,
  // less any discount/credits the platform absorbs).
  const netCents = Math.max(0, goodsCents + shippingFeeCents - discountCents - creditsCents);

  // Gross up so that after Stripe takes (rate * gross + fixed), the platform
  // still nets `netCents`: gross = (net + fixed) / (1 - rate).
  const grossChargedCents = netCents > 0
    ? Math.ceil((netCents + STRIPE_FEE_FIXED_CENTS) / (1 - STRIPE_FEE_RATE))
    : 0;
  const stripeProcessingFeeCents = grossChargedCents - netCents;

  return {
    goodsCents,
    shippingFeeCents,
    discountCents,
    creditsCents,
    platformFeeCents,
    sellerProceedsCents,
    platformRevenueCents: platformFeeCents + shippingFeeCents,
    netCents,
    stripeProcessingFeeCents,
    grossChargedCents,
  };
}

// ─── Ledger entry types ──────────────────────────────────────────────────────

export const LEDGER_ENTRY_TYPES = Object.freeze({
  CHARGE_CAPTURED: "charge_captured", // buyer paid into the platform balance
  REFUND: "refund", // full or partial refund to the buyer
  TRANSFER_INITIATED: "transfer_initiated", // seller payout started
  TRANSFER_SUCCEEDED: "transfer_succeeded", // seller payout confirmed
  TRANSFER_FAILED: "transfer_failed", // payout failed (retry pending)
  DISPUTE_OPENED: "dispute_opened",
  DISPUTE_WON: "dispute_won", // platform/seller won → funds stay
  DISPUTE_LOST: "dispute_lost", // buyer won → treated as refunded
  CANCELLED: "cancelled",
});

export const PAYOUT_STATUS = Object.freeze({
  CANCELLED: "cancelled",
  FROZEN: "frozen", // dispute open — release blocked
  REFUNDED: "refunded", // fully refunded
  PROTECTED: "protected", // held, not yet released to seller
  PENDING: "pending", // transfer initiated, not yet confirmed
  FAILED_RETRY: "failed_retry", // last transfer failed; retry required
  PAID: "paid", // seller fully paid what they are owed
});

const T = LEDGER_ENTRY_TYPES;

/**
 * De-duplicate entries on (type, id) so replayed webhooks fold in once.
 * Entries without an id are always kept (caller-synthesized).
 */
function dedupe(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (e.id == null) { out.push(e); continue; }
    const k = `${e.type}:${e.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/**
 * Fold a sequence of ledger events into balances for one order. All amounts in
 * cents. `orderMoney` supplies the immutable facts (what the seller is owed on
 * full success and the expected gross charge), typically from checkout
 * (computeChargeBreakdown) or the order's stored breakdown.
 *
 * Refund entries may carry `sellerPortionCents` — how much of that refund comes
 * out of the seller's proceeds vs. platform revenue. It defaults to the whole
 * refund (refunds reduce seller proceeds first), capped at the remaining owed.
 *
 * @param {{ sellerProceedsCents:number, grossChargedCents?:number }} orderMoney
 * @param {Array<{type:string, id?:string, amountCents?:number, sellerPortionCents?:number, transferId?:string}>} rawEntries
 * @returns {{
 *   capturedCents:number, refundedCents:number, sellerPaidCents:number,
 *   transferPendingCents:number, protectedCents:number, stripeRefundableCents:number,
 *   sellerOwedCents:number, sellerClawbackCents:number, transferFailures:number,
 *   disputeStatus:('none'|'open'|'won'|'lost'), cancelled:boolean, payoutStatus:string
 * }}
 */
export function reduceLedger(orderMoney, rawEntries = []) {
  const sellerProceedsCents = Math.max(0, Number(orderMoney?.sellerProceedsCents || 0));
  const entries = dedupe(rawEntries);

  let capturedCents = 0;
  let refundedCents = 0;
  let sellerPaidCents = 0;
  let refundSellerPortion = 0;
  let transferFailures = 0;
  let disputeStatus = "none";
  let cancelled = false;

  // Track transfer lifecycle by transferId to compute pending amounts.
  const transferInitiated = new Map(); // transferId → amount
  const transferResolved = new Set(); // transferIds that succeeded or failed
  let lastTransferOutcome = null; // 'succeeded' | 'failed' | null

  for (const e of entries) {
    const amt = Math.max(0, Number(e.amountCents || 0));
    switch (e.type) {
      case T.CHARGE_CAPTURED:
        capturedCents += amt;
        break;
      case T.REFUND: {
        refundedCents += amt;
        const remainingOwed = sellerProceedsCents - refundSellerPortion;
        const portion = e.sellerPortionCents != null
          ? Math.max(0, Number(e.sellerPortionCents))
          : amt;
        refundSellerPortion += Math.min(portion, Math.max(0, remainingOwed));
        break;
      }
      case T.TRANSFER_INITIATED:
        if (e.transferId != null) transferInitiated.set(e.transferId, amt);
        break;
      case T.TRANSFER_SUCCEEDED:
        sellerPaidCents += amt;
        if (e.transferId != null) transferResolved.add(e.transferId);
        lastTransferOutcome = "succeeded";
        break;
      case T.TRANSFER_FAILED:
        transferFailures += 1;
        if (e.transferId != null) transferResolved.add(e.transferId);
        lastTransferOutcome = "failed";
        break;
      case T.DISPUTE_OPENED:
        disputeStatus = "open";
        break;
      case T.DISPUTE_WON:
        disputeStatus = "won";
        break;
      case T.DISPUTE_LOST:
        // Buyer won the dispute: treat the disputed amount as refunded.
        disputeStatus = "lost";
        refundedCents += amt;
        refundSellerPortion += Math.min(amt, Math.max(0, sellerProceedsCents - refundSellerPortion));
        break;
      case T.CANCELLED:
        cancelled = true;
        break;
      default:
        break;
    }
  }

  let transferPendingCents = 0;
  for (const [tid, amount] of transferInitiated) {
    if (!transferResolved.has(tid)) transferPendingCents += amount;
  }

  // What the seller is still owed after refunds allocated to their proceeds.
  const sellerOwedTarget = Math.max(0, sellerProceedsCents - refundSellerPortion);
  const sellerOwedCents = Math.max(0, sellerOwedTarget - sellerPaidCents);
  // If the seller was overpaid relative to what they should keep (e.g. refund
  // after payout), this is the clawback required.
  const sellerClawbackCents = Math.max(0, sellerPaidCents - sellerOwedTarget);

  // "Payment protected" (the demo's headline figure) = the seller's proceeds
  // that are still held — not yet released to the seller and not refunded to
  // the buyer. This is what "payment held until arrival" means to users. It is
  // zero once the seller is paid or the order is fully refunded. (The platform
  // fee and the buyer-paid Stripe processing fee are not part of this figure.)
  const protectedCents = sellerOwedCents;
  // Stripe can refund captured-minus-already-refunded from the platform balance.
  const stripeRefundableCents = Math.max(0, capturedCents - refundedCents);

  const payoutStatus = derivePayoutStatus({
    cancelled,
    disputeStatus,
    capturedCents,
    refundedCents,
    sellerOwedTarget,
    sellerOwedCents,
    transferPendingCents,
    lastTransferOutcome,
  });

  return {
    capturedCents,
    refundedCents,
    sellerPaidCents,
    transferPendingCents,
    protectedCents,
    stripeRefundableCents,
    sellerOwedCents,
    sellerClawbackCents,
    transferFailures,
    disputeStatus,
    cancelled,
    payoutStatus,
  };
}

function derivePayoutStatus(s) {
  if (s.cancelled) return PAYOUT_STATUS.CANCELLED;
  if (s.disputeStatus === "open") return PAYOUT_STATUS.FROZEN;
  if (s.capturedCents > 0 && s.refundedCents >= s.capturedCents) return PAYOUT_STATUS.REFUNDED;
  if (s.transferPendingCents > 0) return PAYOUT_STATUS.PENDING;
  if (s.sellerOwedTarget > 0 && s.sellerOwedCents === 0) return PAYOUT_STATUS.PAID;
  if (s.lastTransferOutcome === "failed" && s.sellerOwedCents > 0) return PAYOUT_STATUS.FAILED_RETRY;
  return PAYOUT_STATUS.PROTECTED;
}

/**
 * Reconcile computed ledger balances against Stripe-reported amounts. Returns a
 * balanced flag and a list of discrepancies (never throws) for the
 * reconciliation queue (Task 22).
 *
 * @param {{capturedCents:number, refundedCents:number, sellerPaidCents:number}} balances
 * @param {{capturedCents?:number, refundedCents?:number, transferredCents?:number}} stripeReported
 * @returns {{ balanced:boolean, discrepancies: Array<{field:string, ledger:number, stripe:number, deltaCents:number}> }}
 */
export function reconcile(balances, stripeReported = {}) {
  const checks = [
    ["capturedCents", balances.capturedCents, stripeReported.capturedCents],
    ["refundedCents", balances.refundedCents, stripeReported.refundedCents],
    ["sellerPaidCents", balances.sellerPaidCents, stripeReported.transferredCents],
  ];
  const discrepancies = [];
  for (const [field, ledger, stripe] of checks) {
    if (stripe == null) continue; // nothing reported for this field
    if (Number(ledger) !== Number(stripe)) {
      discrepancies.push({ field, ledger: Number(ledger), stripe: Number(stripe), deltaCents: Number(ledger) - Number(stripe) });
    }
  }
  return { balanced: discrepancies.length === 0, discrepancies };
}
