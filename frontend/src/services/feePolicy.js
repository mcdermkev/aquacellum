/**
 * feePolicy.js
 *
 * Decides the platform fee RATE for a sale. Pure: no I/O, no imports from api/,
 * deterministic, independently unit-testable — the same shape as
 * promotionEngine.js and checkoutPricing.js, and for the same reason (money math
 * must be reviewable in isolation and must never silently drift).
 *
 * THE PRINCIPLE (docs/AQUASHELLA_FEEDBACK.md §7)
 * The fee is for using the PAYMENT SERVICE, not for making a sale:
 *
 *   cash, recorded in-app  →  0%   we provided no payment service, only the record
 *   card at an event/expo  →  reduced   an event perk; volume and goodwill over margin
 *   card, normal           →  standard  we processed the money and carry the
 *                                       escrow + dispute risk
 *
 * This is what makes the fee defensible to a booth vendor whose alternative is
 * cash, which is free. It also means the vendor can never be blocked by the fee:
 * they simply don't use the paid rail that day.
 *
 * WHAT THIS MODULE DOES NOT DO
 * It does not compute cents. `checkoutPricing.computeCheckoutCharge` owns the
 * fee/payout/gross-up arithmetic and already accepts a `feePercent` argument —
 * this module only chooses the number to hand it. It also does not verify that a
 * sale really happened at an event; that requires a database read and lives
 * server-side in api/stripe.js. Passing an `eventId` here asserts "already
 * verified", exactly as `funding` does for promotions.
 */

/** The payment rails a sale can travel on. */
export const FEE_RAIL = Object.freeze({
  /** Recorded in-app after an in-person cash exchange. No payment service used. */
  CASH: "cash",
  /** Card, at a verified event/expo. */
  CARD_EVENT: "card_event",
  /** Card, ordinary online or pickup sale. */
  CARD: "card",
});

/** Matches the on-chain TOTAL_FEE_BPS = 400 and checkoutPricing's default. */
export const DEFAULT_STANDARD_FEE_PERCENT = 4;

/** Halved at events. A deliberate, reversible business number, not a constant of nature. */
export const DEFAULT_EVENT_FEE_PERCENT = 2;

/** Stable reason codes, stamped into Stripe metadata for reconciliation. */
export const FEE_REASON = Object.freeze({
  CASH: "cash",
  EVENT: "event",
  STANDARD: "standard",
});

const VALID_RAILS = Object.freeze(Object.values(FEE_RAIL));

/**
 * Resolve the fee rate for a sale.
 *
 * Fails to the STANDARD rate, never to a discount. An unrecognised rail, a
 * missing eventId on the event rail, or a nonsensical percentage all land on the
 * full rate — the failure mode of a fee policy should cost the platform nothing
 * and surprise the seller in the safe direction (they were quoted standard and
 * charged standard).
 *
 * @param {Object} args
 * @param {string} args.rail - a FEE_RAIL value
 * @param {string|number|null} [args.eventId] - REQUIRED for CARD_EVENT, and must
 *   already have been verified server-side. Its presence is what proves the perk.
 * @param {number} [args.standardPercent=4]
 * @param {number} [args.eventPercent=2]
 * @returns {{ feePercent: number, reason: string }}
 */
export function resolveFeePolicy({
  rail,
  eventId = null,
  standardPercent = DEFAULT_STANDARD_FEE_PERCENT,
  eventPercent = DEFAULT_EVENT_FEE_PERCENT,
} = {}) {
  const standard = sanitizePercent(standardPercent, DEFAULT_STANDARD_FEE_PERCENT);

  if (!VALID_RAILS.includes(rail)) {
    return { feePercent: standard, reason: FEE_REASON.STANDARD };
  }

  // Cash never reaches the checkout money path at all (the state machine has no
  // payout states for a cash pickup), so this branch is mostly a statement of
  // intent — but stating it means a future caller that DOES route cash through a
  // fee calculation gets 0 rather than silently charging for a service we never
  // rendered.
  if (rail === FEE_RAIL.CASH) {
    return { feePercent: 0, reason: FEE_REASON.CASH };
  }

  if (rail === FEE_RAIL.CARD_EVENT) {
    const hasEvent = eventId != null && String(eventId).trim() !== "";
    if (!hasEvent) {
      // The event rail without a verified event is just a card sale.
      return { feePercent: standard, reason: FEE_REASON.STANDARD };
    }
    const event = sanitizePercent(eventPercent, DEFAULT_EVENT_FEE_PERCENT);
    // A misconfigured "reduced" rate above standard would quietly overcharge at
    // the exact moment we promised a discount. Clamp to standard.
    const effective = Math.min(event, standard);
    return { feePercent: effective, reason: `${FEE_REASON.EVENT}:${String(eventId)}` };
  }

  return { feePercent: standard, reason: FEE_REASON.STANDARD };
}

/**
 * A percentage must be a finite number in [0, 100]. Anything else falls back to
 * the supplied default rather than propagating NaN into a charge.
 */
function sanitizePercent(value, fallback) {
  // Reject non-numeric types EXPLICITLY before coercing. A JS default parameter
  // only fills in for `undefined`, so an explicit `null` reaches this function —
  // and `Number(null)` is 0, which is finite and inside [0,100]. Coercing first
  // would therefore turn a null rate into a 0% fee: revenue silently given away
  // by a caller that passed a missing value rather than omitting the argument.
  // Booleans coerce the same way (`Number(false) === 0`) and are rejected too.
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return fallback;
  return n;
}

/**
 * Human-readable line for a seller-facing fee estimate, so the UI never
 * hardcodes "4%" again (BatchListingWizard did, and it becomes wrong the moment a
 * rate varies).
 *
 * @param {{feePercent:number, reason:string}} policy
 * @returns {string}
 */
export function describeFeePolicy(policy) {
  const pct = policy?.feePercent ?? DEFAULT_STANDARD_FEE_PERCENT;
  if (pct === 0) return "No platform fee — you recorded this sale yourself.";
  if (String(policy?.reason || "").startsWith(FEE_REASON.EVENT)) {
    return `${pct}% platform fee (reduced event rate).`;
  }
  return `${pct}% platform fee on card sales.`;
}
