/**
 * orderCopy.js
 *
 * The single source of buyer-facing order language (Task 18, seeding the
 * Task 2 Web2 language system for the order surface). Replaces the inline
 * status-label logic duplicated across OrderTimeline.buildSteps and
 * OrderReceipt.getStatusLabel with one canonical-state-aware vocabulary.
 *
 * Speaks ORDER_STATES (marketplaceStateMachine.js) — not legacy Dexie ints —
 * so every fulfillment method (shipping, courier, prepaid pickup, cash
 * pickup) shares one status axis and one Web2-safe wording table.
 *
 * See docs/MARKETPLACE_IMPLEMENTATION_PLAN.md "Web3 Stays Invisible" and
 * docs/TASK_18_BUYER_ORDERS_SPEC.md §2.
 *
 * Pure and dependency-free (besides the canonical state enum).
 */

import { ORDER_STATES, FULFILLMENT_METHODS } from "./marketplaceStateMachine.js";

// ─── Prohibited Web3 terminology ───────────────────────────────────────────
// Every label/next-action string (casual or pro) must be free of these. Used
// by this module's own invariant test and reusable by component source-guard
// tests. Matched case-insensitively as substrings.
export const PROHIBITED_TERMS = Object.freeze([
  "wallet",
  "nft",
  "token",
  "mint",
  "blockchain",
  "on-chain",
  "onchain",
  "smart contract",
  "escrow",
  "gas",
  "relayer",
  "transaction hash",
  "crypto",
]);

/**
 * Whether a string contains any prohibited Web3 term (case-insensitive).
 * @param {string} text
 * @returns {boolean}
 */
export function containsProhibitedTerm(text) {
  const lower = String(text || "").toLowerCase();
  return PROHIBITED_TERMS.some((term) => lower.includes(term));
}

// ─── Tone vocabulary ────────────────────────────────────────────────────────

export const TONE = Object.freeze({
  INFO: "info",
  PROGRESS: "progress",
  GOOD: "good",
  ALERT: "alert",
});

// ─── Status labels, keyed by canonical order state ─────────────────────────
// Each entry provides { casual, pro, tone, icon }. Icon pairs with the tone so
// status is never color-only (accessibility — plan Task 21 / spec §4.12).

const S = ORDER_STATES;

const STATUS_TABLE = Object.freeze({
  [S.CREATED]: { casual: "Order placed", pro: "Order placed", tone: TONE.INFO, icon: "🧾" },
  [S.PAYMENT_PENDING]: { casual: "Confirming payment", pro: "Payment authorizing", tone: TONE.PROGRESS, icon: "⏳" },
  [S.PAYMENT_PROTECTED]: { casual: "Payment protected", pro: "Payment protected", tone: TONE.GOOD, icon: "🛡️" },
  [S.PREPARING]: { casual: "Getting your fish ready", pro: "Seller preparing order", tone: TONE.PROGRESS, icon: "📦" },
  [S.IN_TRANSIT]: { casual: "On its way", pro: "In transit", tone: TONE.PROGRESS, icon: "🚚" },
  [S.PICKUP_READY]: { casual: "Ready for pickup", pro: "Pickup ready", tone: TONE.PROGRESS, icon: "📍" },
  [S.DELIVERED]: { casual: "Arrived", pro: "Delivered", tone: TONE.GOOD, icon: "🏠" },
  [S.REVIEW_WINDOW]: { casual: "Arrived — let us know if there's a problem", pro: "Delivered — claim window open", tone: TONE.PROGRESS, icon: "🕓" },
  [S.NON_DELIVERY]: { casual: "Running late — we're looking into it", pro: "Non-delivery — under review", tone: TONE.ALERT, icon: "❔" },
  [S.HANDOFF_CONFIRMED]: { casual: "All good — confirmed", pro: "Arrival confirmed", tone: TONE.GOOD, icon: "✅" },
  [S.CLAIM_OPEN]: { casual: "Problem reported — under review", pro: "Claim open — under review", tone: TONE.ALERT, icon: "⚠️" },
  [S.PARTIALLY_RESOLVED]: { casual: "Partly resolved", pro: "Partially resolved", tone: TONE.ALERT, icon: "🧩" },
  [S.CERTIFICATE_TRANSFERRED]: { casual: "Ownership transferred", pro: "Ownership record transferred", tone: TONE.GOOD, icon: "📜" },
  [S.SELLER_PAID]: { casual: "Completed", pro: "Seller paid", tone: TONE.GOOD, icon: "✅" },
  [S.COMPLETED]: { casual: "Completed", pro: "Completed", tone: TONE.GOOD, icon: "✅" },
  [S.REFUNDED]: { casual: "Refunded", pro: "Refunded", tone: TONE.ALERT, icon: "↩️" },
  [S.CANCELLED]: { casual: "Cancelled", pro: "Cancelled", tone: TONE.ALERT, icon: "🚫" },
  [S.RECONCILIATION]: { casual: "Being looked into", pro: "Under manual review", tone: TONE.ALERT, icon: "🔎" },
});

/**
 * Look up the buyer-facing label for a canonical order state.
 * @param {string} canonicalState - an ORDER_STATES value
 * @param {{ casual?: boolean }} [opts]
 * @returns {{ label:string, tone:string, icon:string }}
 */
export function orderStatusLabel(canonicalState, opts = {}) {
  const casual = opts.casual !== false;
  const entry = STATUS_TABLE[canonicalState];
  if (!entry) {
    return { label: casual ? "Order update" : "Status unavailable", tone: TONE.INFO, icon: "ℹ️" };
  }
  return { label: casual ? entry.casual : entry.pro, tone: entry.tone, icon: entry.icon };
}

// ─── Next-action vocabulary ─────────────────────────────────────────────────

export const NEXT_ACTION_KIND = Object.freeze({
  TRACK: "track",
  CONFIRM_ARRIVAL: "confirm_arrival",
  SHOW_PICKUP_CODE: "show_pickup_code",
  AWAIT_SELLER: "await_seller",
  REPORT_PROBLEM: "report_problem",
  VIEW_RECEIPT: "view_receipt",
  VIEW_RESOLUTION: "view_resolution",
  NONE: "none",
});

const NA = NEXT_ACTION_KIND;

/** Next-action copy for each (kind) — independent of method/state details. */
const NEXT_ACTION_COPY = Object.freeze({
  [NA.TRACK]: { casual: "Track your order", pro: "Track shipment" },
  [NA.CONFIRM_ARRIVAL]: { casual: "Confirm your fish arrived safely", pro: "Confirm arrival" },
  [NA.SHOW_PICKUP_CODE]: { casual: "Show your pickup code to the seller", pro: "Present handoff code" },
  [NA.AWAIT_SELLER]: { casual: "The seller is getting your order ready", pro: "Awaiting seller preparation" },
  [NA.REPORT_PROBLEM]: { casual: "Something wrong? Report a problem", pro: "Report an issue" },
  [NA.VIEW_RECEIPT]: { casual: "View your receipt", pro: "View receipt" },
  [NA.VIEW_RESOLUTION]: { casual: "See how this was resolved", pro: "View resolution" },
  [NA.NONE]: { casual: "", pro: "" },
});

/**
 * Determine the buyer's primary next action for an order, given its
 * fulfillment method and canonical state. Cash pickup never offers
 * report_problem — cash sales carry no platform payment protection
 * (plan "DOA Protection Policy"), so there is nothing to freeze/refund.
 *
 * @param {string} method - a FULFILLMENT_METHODS value
 * @param {string} canonicalState - an ORDER_STATES value
 * @param {{ hasOpenClaim?: boolean }} [flags]
 * @returns {string} a NEXT_ACTION_KIND value
 */
export function nextActionKind(method, canonicalState, flags = {}) {
  const isCash = method === FULFILLMENT_METHODS.CASH_PICKUP;
  const isPickup = method === FULFILLMENT_METHODS.PREPAID_PICKUP || isCash;
  const isShipLike = method === FULFILLMENT_METHODS.SHIPPING || method === FULFILLMENT_METHODS.COURIER;

  if (flags.hasOpenClaim || canonicalState === S.CLAIM_OPEN) return NA.NONE;
  if (canonicalState === S.PARTIALLY_RESOLVED || canonicalState === S.REFUNDED) return NA.VIEW_RESOLUTION;

  switch (canonicalState) {
    case S.CREATED:
    case S.PAYMENT_PENDING:
    case S.PAYMENT_PROTECTED:
    case S.PREPARING:
      return NA.AWAIT_SELLER;
    case S.IN_TRANSIT:
    case S.NON_DELIVERY:
      return isShipLike ? NA.TRACK : NA.AWAIT_SELLER;
    case S.PICKUP_READY:
      return isPickup ? NA.SHOW_PICKUP_CODE : NA.AWAIT_SELLER;
    case S.DELIVERED:
    case S.REVIEW_WINDOW:
      // Cash has no DOA workflow — a buyer confirming a cash handoff is the
      // acceptable-condition confirmation itself (plan §"No DOA protection").
      return isCash ? NA.NONE : NA.CONFIRM_ARRIVAL;
    case S.HANDOFF_CONFIRMED:
    case S.CERTIFICATE_TRANSFERRED:
    case S.SELLER_PAID:
    case S.COMPLETED:
      return NA.VIEW_RECEIPT;
    case S.CANCELLED:
    case S.RECONCILIATION:
      return NA.NONE;
    default:
      return NA.NONE;
  }
}

/**
 * Build the full next-action copy for a view.
 * @param {{ method:string, canonicalState:string, hasOpenClaim?:boolean }} view
 * @param {{ casual?: boolean }} [opts]
 * @returns {{ kind:string, copy:string }}
 */
export function nextActionCopy(view, opts = {}) {
  const casual = opts.casual !== false;
  const kind = nextActionKind(view.method, view.canonicalState, { hasOpenClaim: view.hasOpenClaim });
  const entry = NEXT_ACTION_COPY[kind] || NEXT_ACTION_COPY[NA.NONE];
  return { kind, copy: casual ? entry.casual : entry.pro };
}

/**
 * Whether an order (by method + state) may ever offer a "report a problem"
 * action. Cash pickup is categorically excluded — no platform payment
 * protection exists to freeze (plan "No DOA protection — disclose it").
 * @param {string} method
 * @returns {boolean}
 */
export function allowsProblemReport(method) {
  return method !== FULFILLMENT_METHODS.CASH_PICKUP;
}

/**
 * The plain-language disclosure shown at cash checkout and again at handoff
 * (plan "No DOA protection — disclose it"). Exported so the checkout and
 * handoff surfaces show identical wording.
 * @param {{ casual?: boolean }} [opts]
 * @returns {string}
 */
export function cashNoProtectionDisclosure(opts = {}) {
  const casual = opts.casual !== false;
  return casual
    ? "This is a cash sale — there's no payment protection or claim process. Please check your fish before you confirm you've received them."
    : "Cash sales carry no platform payment protection and no claim workflow. Inspect livestock before confirming receipt.";
}

// ─── Seller next-action vocabulary (Task 19) ────────────────────────────────
// Mirrors the buyer NEXT_ACTION_KIND/nextActionCopy pattern above, but for the
// seller-side fulfillment queue (docs/TASK_19_SELLER_OPS_SPEC.md §2). Kept in
// this module — not a separate copy table — so there is one order-language
// module and one PROHIBITED_TERMS invariant covering both roles.

export const SELLER_ACTION_KIND = Object.freeze({
  BUY_LABEL: "buy_label",
  // Secondary/fallback affordance alongside BUY_LABEL (manual tracking entry,
  // matching CheckoutSummary's <details> fallback) — sellerNextActionKind()
  // never resolves to this on its own; it's a UI-composed action, not a
  // distinct (method,state) outcome. Kept here so the copy table and any
  // switch over SELLER_ACTION_KIND stay exhaustive.
  MARK_DISPATCHED: "mark_dispatched",
  REQUEST_COURIER: "request_courier",
  SCHEDULE_PICKUP: "schedule_pickup",
  SCAN_HANDOFF: "scan_handoff",
  CONFIRM_CASH: "confirm_cash",
  RESPOND_TO_CLAIM: "respond_to_claim",
  AWAITING_BUYER: "awaiting_buyer",
  VIEW_RECEIPT: "view_receipt",
  NONE: "none",
});

const SA = SELLER_ACTION_KIND;

/** Seller-facing next-action copy for each SELLER_ACTION_KIND. */
const SELLER_NEXT_ACTION_COPY = Object.freeze({
  [SA.BUY_LABEL]: { casual: "Buy a shipping label", pro: "Purchase shipping label" },
  [SA.MARK_DISPATCHED]: { casual: "Enter tracking manually", pro: "Mark dispatched" },
  [SA.REQUEST_COURIER]: { casual: "Request a courier pickup", pro: "Request courier pickup" },
  [SA.SCHEDULE_PICKUP]: { casual: "Schedule the pickup", pro: "Schedule pickup" },
  [SA.SCAN_HANDOFF]: { casual: "Scan the buyer's pickup code", pro: "Scan handoff code" },
  [SA.CONFIRM_CASH]: { casual: "Confirm cash received", pro: "Confirm cash handoff" },
  [SA.RESPOND_TO_CLAIM]: { casual: "Respond to the buyer's claim", pro: "Respond to claim" },
  [SA.AWAITING_BUYER]: { casual: "Waiting on the buyer", pro: "Awaiting buyer confirmation" },
  [SA.VIEW_RECEIPT]: { casual: "View the receipt", pro: "View receipt" },
  [SA.NONE]: { casual: "", pro: "" },
});

/**
 * Determine the seller's primary next action for an order, given its
 * fulfillment method and canonical state. Pure and exhaustively tested —
 * see docs/TASK_19_SELLER_OPS_SPEC.md §2 for the worked examples this
 * mirrors (shipping+protected→buy_label, shipping+in_transit→awaiting_buyer,
 * prepaid+pickup_ready→scan_handoff, cash+pickup_ready→confirm_cash,
 * claim_open→respond_to_claim, terminal→view_receipt).
 *
 * @param {string} method - a FULFILLMENT_METHODS value
 * @param {string} canonicalState - an ORDER_STATES value
 * @param {{ hasOpenClaim?: boolean }} [flags]
 * @returns {string} a SELLER_ACTION_KIND value
 */
export function sellerNextActionKind(method, canonicalState, flags = {}) {
  const isCash = method === FULFILLMENT_METHODS.CASH_PICKUP;
  const isPickup = method === FULFILLMENT_METHODS.PREPAID_PICKUP || isCash;
  const isCourier = method === FULFILLMENT_METHODS.COURIER;
  const isShipLike = method === FULFILLMENT_METHODS.SHIPPING || isCourier;

  if (flags.hasOpenClaim || canonicalState === S.CLAIM_OPEN) return SA.RESPOND_TO_CLAIM;

  switch (canonicalState) {
    case S.CREATED:
    case S.PAYMENT_PENDING:
      // Payment isn't protected yet — nothing for the seller to act on.
      return SA.NONE;
    case S.PAYMENT_PROTECTED:
    case S.PREPARING:
      if (isCourier) return SA.REQUEST_COURIER;
      if (isPickup) return SA.SCHEDULE_PICKUP;
      return SA.BUY_LABEL; // shipping
    case S.IN_TRANSIT:
    case S.NON_DELIVERY:
      return isShipLike ? SA.AWAITING_BUYER : SA.NONE;
    case S.PICKUP_READY:
      if (isCash) return SA.CONFIRM_CASH;
      if (isPickup) return SA.SCAN_HANDOFF;
      return SA.NONE;
    case S.DELIVERED:
    case S.REVIEW_WINDOW:
      return isShipLike ? SA.AWAITING_BUYER : SA.NONE;
    case S.HANDOFF_CONFIRMED:
    case S.CERTIFICATE_TRANSFERRED:
    case S.SELLER_PAID:
    case S.COMPLETED:
    case S.REFUNDED:
    case S.CANCELLED:
    case S.PARTIALLY_RESOLVED:
      return SA.VIEW_RECEIPT;
    case S.RECONCILIATION:
      return SA.NONE;
    default:
      return SA.NONE;
  }
}

/**
 * Build the full seller-facing next-action copy for a view.
 * @param {{ method:string, canonicalState:string, hasOpenClaim?:boolean }} view
 * @param {{ casual?: boolean }} [opts]
 * @returns {{ kind:string, copy:string }}
 */
export function sellerNextActionCopy(view, opts = {}) {
  const casual = opts.casual !== false;
  const kind = sellerNextActionKind(view.method, view.canonicalState, { hasOpenClaim: view.hasOpenClaim });
  const entry = SELLER_NEXT_ACTION_COPY[kind] || SELLER_NEXT_ACTION_COPY[SA.NONE];
  return { kind, copy: casual ? entry.casual : entry.pro };
}
