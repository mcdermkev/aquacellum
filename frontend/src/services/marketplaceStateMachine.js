/**
 * marketplaceStateMachine.js
 *
 * Canonical order state machine for the Aquadex marketplace. This is the single
 * authoritative encoding of the states, per-fulfillment-path transitions, and
 * guard rules defined in docs/MARKETPLACE_STATE_MODEL.md (Task 1 deliverable).
 *
 * Pure and dependency-free: it answers "is this transition allowed?" and "what
 * are the money/certificate/inventory positions of this state?" so every
 * surface (checkout, orders UI, cron, reconciliation) shares one source of
 * truth. It does NOT perform the transition, persist anything, or check actor
 * identity — role/authorization enforcement is Task 3. It validates the
 * state+method legality of a proposed transition only.
 *
 * See MARKETPLACE_STATE_MODEL.md §3 (states), §4 (line items), §5 (per-path
 * transitions), §6 (legacy mapping), §9 (guards).
 */

// ─── Fulfillment methods (§5) ───────────────────────────────────────────────

export const FULFILLMENT_METHODS = Object.freeze({
  SHIPPING: "shipping",
  COURIER: "courier",
  PREPAID_PICKUP: "prepaid_pickup",
  CASH_PICKUP: "cash_pickup",
});

const ALL_METHODS = Object.freeze(Object.values(FULFILLMENT_METHODS));

// ─── Order-level states (§3) ────────────────────────────────────────────────

export const ORDER_STATES = Object.freeze({
  CREATED: "created",
  PAYMENT_PENDING: "payment_pending",
  PAYMENT_PROTECTED: "payment_protected",
  PREPARING: "preparing",
  IN_TRANSIT: "in_transit",
  PICKUP_READY: "pickup_ready",
  DELIVERED: "delivered",
  REVIEW_WINDOW: "review_window",
  NON_DELIVERY: "non_delivery",
  HANDOFF_CONFIRMED: "handoff_confirmed",
  CLAIM_OPEN: "claim_open",
  PARTIALLY_RESOLVED: "partially_resolved",
  CERTIFICATE_TRANSFERRED: "certificate_transferred",
  SELLER_PAID: "seller_paid",
  COMPLETED: "completed",
  REFUNDED: "refunded",
  CANCELLED: "cancelled",
  RECONCILIATION: "reconciliation",
});

export const TERMINAL_STATES = Object.freeze([
  ORDER_STATES.COMPLETED,
  ORDER_STATES.REFUNDED,
  ORDER_STATES.CANCELLED,
]);

// Positions each state encodes (§3), for surfaces that need to explain an order
// without re-deriving the semantics.
export const STATE_POSITIONS = Object.freeze({
  [ORDER_STATES.CREATED]: { money: "none", certificate: "intended", inventory: "reserved" },
  [ORDER_STATES.PAYMENT_PENDING]: { money: "authorizing", certificate: "intended", inventory: "reserved" },
  [ORDER_STATES.PAYMENT_PROTECTED]: { money: "held", certificate: "intended", inventory: "committed" },
  [ORDER_STATES.PREPARING]: { money: "held", certificate: "intended", inventory: "committed" },
  [ORDER_STATES.IN_TRANSIT]: { money: "held", certificate: "intended", inventory: "committed" },
  [ORDER_STATES.PICKUP_READY]: { money: "held", certificate: "intended", inventory: "committed" },
  [ORDER_STATES.DELIVERED]: { money: "held", certificate: "intended", inventory: "committed" },
  [ORDER_STATES.REVIEW_WINDOW]: { money: "held", certificate: "intended", inventory: "committed" },
  [ORDER_STATES.NON_DELIVERY]: { money: "held", certificate: "intended", inventory: "committed" },
  [ORDER_STATES.HANDOFF_CONFIRMED]: { money: "held", certificate: "ready", inventory: "committed" },
  [ORDER_STATES.CLAIM_OPEN]: { money: "frozen", certificate: "paused", inventory: "committed" },
  [ORDER_STATES.PARTIALLY_RESOLVED]: { money: "partial", certificate: "mixed", inventory: "committed" },
  [ORDER_STATES.CERTIFICATE_TRANSFERRED]: { money: "clearing", certificate: "transferred", inventory: "consumed" },
  [ORDER_STATES.SELLER_PAID]: { money: "paid_out", certificate: "transferred", inventory: "consumed" },
  [ORDER_STATES.COMPLETED]: { money: "settled", certificate: "transferred", inventory: "consumed" },
  [ORDER_STATES.REFUNDED]: { money: "refunded", certificate: "not_transferred", inventory: "released" },
  [ORDER_STATES.CANCELLED]: { money: "voided", certificate: "not_transferred", inventory: "released" },
  [ORDER_STATES.RECONCILIATION]: { money: "indeterminate", certificate: "indeterminate", inventory: "held" },
});

// ─── Line-item states (§4) ──────────────────────────────────────────────────

export const LINE_ITEM_STATES = Object.freeze({
  PENDING: "pending",
  HEALTHY: "healthy",
  DOA_CLAIMED: "doa_claimed",
  REFUNDED: "refunded",
  REPLACEMENT_PENDING: "replacement_pending",
  REPLACED: "replaced",
  DENIED: "denied",
});

export const TERMINAL_LINE_ITEM_STATES = Object.freeze([
  LINE_ITEM_STATES.REFUNDED,
  LINE_ITEM_STATES.REPLACED,
  LINE_ITEM_STATES.DENIED,
]);

// ─── Transition graph (§5) ──────────────────────────────────────────────────
// Union of all paths. Method-specific legality is applied on top in
// isTransitionAllowed via METHOD_STATE_EXCLUSIONS and the transit/paid guards.

const S = ORDER_STATES;

const ADJACENCY = Object.freeze({
  [S.CREATED]: [S.PAYMENT_PENDING, S.PICKUP_READY, S.CANCELLED],
  [S.PAYMENT_PENDING]: [S.PAYMENT_PROTECTED, S.CANCELLED],
  [S.PAYMENT_PROTECTED]: [S.PREPARING, S.CANCELLED],
  [S.PREPARING]: [S.IN_TRANSIT, S.PICKUP_READY],
  [S.IN_TRANSIT]: [S.DELIVERED, S.NON_DELIVERY],
  [S.NON_DELIVERY]: [S.DELIVERED, S.CLAIM_OPEN, S.RECONCILIATION],
  [S.DELIVERED]: [S.HANDOFF_CONFIRMED, S.REVIEW_WINDOW, S.CLAIM_OPEN],
  [S.REVIEW_WINDOW]: [S.HANDOFF_CONFIRMED, S.CLAIM_OPEN],
  [S.PICKUP_READY]: [S.HANDOFF_CONFIRMED],
  [S.HANDOFF_CONFIRMED]: [S.CERTIFICATE_TRANSFERRED],
  [S.CLAIM_OPEN]: [S.REFUNDED, S.PARTIALLY_RESOLVED, S.HANDOFF_CONFIRMED],
  [S.PARTIALLY_RESOLVED]: [S.CERTIFICATE_TRANSFERRED],
  [S.CERTIFICATE_TRANSFERRED]: [S.SELLER_PAID, S.COMPLETED],
  [S.SELLER_PAID]: [S.COMPLETED],
  // Terminal states may only be reopened into reconciliation by an operator.
  [S.COMPLETED]: [S.RECONCILIATION],
  [S.REFUNDED]: [S.RECONCILIATION],
  [S.CANCELLED]: [],
  [S.RECONCILIATION]: [S.REFUNDED, S.DELIVERED],
});

// States that are invalid for a given method (§5.4/§9).
// Cash moves no platform money: no payment states, no seller payout.
// Pickup methods have no transit/delivery/claim-window states.
const METHOD_STATE_EXCLUSIONS = Object.freeze({
  [FULFILLMENT_METHODS.CASH_PICKUP]: [
    S.PAYMENT_PENDING, S.PAYMENT_PROTECTED, S.SELLER_PAID,
    S.IN_TRANSIT, S.NON_DELIVERY, S.DELIVERED, S.REVIEW_WINDOW,
  ],
  [FULFILLMENT_METHODS.PREPAID_PICKUP]: [
    S.IN_TRANSIT, S.NON_DELIVERY, S.DELIVERED, S.REVIEW_WINDOW,
  ],
  [FULFILLMENT_METHODS.SHIPPING]: [S.PICKUP_READY],
  [FULFILLMENT_METHODS.COURIER]: [S.PICKUP_READY],
});

/**
 * Whether a state is reachable for a given fulfillment method.
 * @param {string} state
 * @param {string} method
 * @returns {boolean}
 */
export function isStateValidForMethod(state, method) {
  if (!ALL_METHODS.includes(method)) return false;
  const excluded = METHOD_STATE_EXCLUSIONS[method] || [];
  return !excluded.includes(state);
}

/**
 * Validate a proposed order-level transition against the canonical graph and
 * the method's constraints. Returns a structured result rather than throwing so
 * callers can surface a reason. Does not check actor/role (Task 3) or
 * idempotency (enforced at the persistence layer).
 *
 * @param {string} from - current canonical state
 * @param {string} to - proposed canonical state
 * @param {{ method?: string, isOperator?: boolean }} [opts]
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function isTransitionAllowed(from, to, opts = {}) {
  const { method, isOperator = false } = opts;

  if (!Object.values(ORDER_STATES).includes(from)) {
    return { allowed: false, reason: `unknown from-state: ${from}` };
  }
  if (!Object.values(ORDER_STATES).includes(to)) {
    return { allowed: false, reason: `unknown to-state: ${to}` };
  }
  if (from === to) {
    return { allowed: false, reason: "no-op transition" };
  }

  // Terminal states may only move into reconciliation, and only by an operator.
  if (TERMINAL_STATES.includes(from)) {
    if (to !== S.RECONCILIATION) {
      return { allowed: false, reason: `terminal state ${from} cannot transition to ${to}` };
    }
    if (!isOperator) {
      return { allowed: false, reason: "only an operator may reopen a terminal order into reconciliation" };
    }
  }

  // Must be an edge in the canonical graph.
  const targets = ADJACENCY[from] || [];
  if (!targets.includes(to)) {
    return { allowed: false, reason: `no canonical edge ${from} → ${to}` };
  }

  // Method-specific legality: both endpoints must be valid for the method.
  if (method !== undefined) {
    if (!ALL_METHODS.includes(method)) {
      return { allowed: false, reason: `unknown fulfillment method: ${method}` };
    }
    if (!isStateValidForMethod(to, method)) {
      return { allowed: false, reason: `state ${to} is not valid for method ${method}` };
    }
    if (!isStateValidForMethod(from, method)) {
      return { allowed: false, reason: `state ${from} is not valid for method ${method}` };
    }
    // Cash orders never pay a seller through the platform; certificate transfer
    // completes the order directly.
    if (method === FULFILLMENT_METHODS.CASH_PICKUP && to === S.SELLER_PAID) {
      return { allowed: false, reason: "cash orders do not route a platform payout" };
    }
  }

  return { allowed: true };
}

/**
 * List the canonical states a method actually traverses on its happy path,
 * for documentation/verification (the "tested state-transition table" demo).
 * @param {string} method
 * @returns {string[]}
 */
export function reachableStatesForMethod(method) {
  return Object.values(ORDER_STATES).filter((s) => isStateValidForMethod(s, method));
}

/**
 * Whether an order can still be cancelled outright (before fulfillment begins).
 * After PREPARING, unwinding goes through refund/dispute, not a bare cancel (§5.6).
 * @param {string} state
 * @returns {boolean}
 */
export function isCancellable(state) {
  return [S.CREATED, S.PAYMENT_PENDING, S.PAYMENT_PROTECTED].includes(state);
}

// ─── Legacy → canonical mapping (§6) ────────────────────────────────────────
// Best-effort, representative mapping for seeding the migration (Task 23). The
// legacy cloud `orders.status` is many-to-one against canonical states (e.g.
// 'released' spans handoff/transfer/payout), so this returns the primary
// canonical state for a given legacy value; migration reconciles finer detail
// using fiat_settlements + on-chain escrow status.
const LEGACY_CLOUD_TO_CANONICAL = Object.freeze({
  pending: S.CREATED,
  locked: S.PAYMENT_PROTECTED,
  dispatched: S.IN_TRANSIT,
  released: S.CERTIFICATE_TRANSFERRED,
  resolved_released: S.SELLER_PAID,
  completed: S.COMPLETED,
  settled: S.COMPLETED,
  disputed: S.CLAIM_OPEN,
  refunded: S.REFUNDED,
  failed: S.CANCELLED,
});

/**
 * Map a legacy cloud `orders.status` to its representative canonical state.
 * @param {string} legacyStatus
 * @returns {string|null} canonical state, or null if unrecognized
 */
export function legacyCloudStatusToCanonical(legacyStatus) {
  return LEGACY_CLOUD_TO_CANONICAL[legacyStatus] ?? null;
}
