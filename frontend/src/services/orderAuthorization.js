/**
 * orderAuthorization.js
 *
 * The canonical authorization boundary for order state transitions (Task 3).
 *
 * Today the "who may trigger which transition" rules are scattered inside the
 * serverless handlers (e.g. handleRelease enforces "seller can only force-
 * release a shipping order after its safety window; the buyer confirms other
 * held orders; the curator resolves disputes"). This module centralizes those
 * rules into one place and composes them with the canonical state machine
 * (marketplaceStateMachine.js) so there is a single answer to:
 *
 *     "Can this actor move this order from state A to state B?"
 *
 * It is pure and dependency-free. It does NOT authenticate the actor (that is
 * verifyPrivyToken / wallet-signature recovery / CRON_SECRET at the edge), and
 * it does NOT persist anything. Callers authenticate first, build a normalized
 * Actor, then ask authorizeTransition before performing and recording a move.
 *
 * See docs/MARKETPLACE_STATE_MODEL.md §5/§8/§9.
 */

import {
  ORDER_STATES as S,
  isTransitionAllowed,
} from "./marketplaceStateMachine.js";

// ─── Actor roles ────────────────────────────────────────────────────────────

export const ACTOR_ROLES = Object.freeze({
  BUYER: "buyer",
  SELLER: "seller",
  CURATOR: "curator", // trust & safety / dispute resolution (CURATOR_WALLET)
  OPERATOR: "operator", // reconciliation / manual recovery (Task 22)
  SYSTEM: "system", // platform automation: Stripe/ship webhooks, cron jobs
});

const R = ACTOR_ROLES;

// Roles permitted to reopen a terminal order into reconciliation, matching the
// state machine's isOperator gate (§9).
const OPERATOR_ROLES = Object.freeze([R.OPERATOR, R.CURATOR]);

// ─── Per-transition permission matrix ────────────────────────────────────────
// Maps "from->to" to the set of roles allowed to trigger it. A transition that
// is legal in the state graph but absent here is denied for everyone except by
// explicit design (fail closed). Keep this aligned with §5 of the state model.

const key = (from, to) => `${from}->${to}`;

const TRANSITION_PERMISSIONS = Object.freeze({
  // Checkout / creation
  [key(S.CREATED, S.PAYMENT_PENDING)]: [R.BUYER, R.SYSTEM],
  [key(S.CREATED, S.PICKUP_READY)]: [R.SELLER, R.SYSTEM], // cash order prepared
  [key(S.CREATED, S.CANCELLED)]: [R.BUYER, R.SELLER, R.SYSTEM],

  // Payment (Stripe webhooks are SYSTEM)
  [key(S.PAYMENT_PENDING, S.PAYMENT_PROTECTED)]: [R.SYSTEM],
  [key(S.PAYMENT_PENDING, S.CANCELLED)]: [R.BUYER, R.SYSTEM],
  [key(S.PAYMENT_PROTECTED, S.PREPARING)]: [R.SELLER, R.SYSTEM],
  [key(S.PAYMENT_PROTECTED, S.CANCELLED)]: [R.CURATOR, R.SYSTEM],

  // Fulfillment dispatch
  [key(S.PREPARING, S.IN_TRANSIT)]: [R.SELLER, R.SYSTEM], // label buy / ship-webhook
  [key(S.PREPARING, S.PICKUP_READY)]: [R.SELLER, R.SYSTEM],

  // Transit / delivery (carrier & courier events are SYSTEM)
  [key(S.IN_TRANSIT, S.DELIVERED)]: [R.SYSTEM],
  [key(S.IN_TRANSIT, S.NON_DELIVERY)]: [R.SYSTEM],
  [key(S.NON_DELIVERY, S.DELIVERED)]: [R.SYSTEM],
  [key(S.NON_DELIVERY, S.CLAIM_OPEN)]: [R.BUYER],
  [key(S.NON_DELIVERY, S.RECONCILIATION)]: [R.SYSTEM, R.OPERATOR, R.CURATOR],

  // Arrival confirmation
  [key(S.DELIVERED, S.HANDOFF_CONFIRMED)]: [R.BUYER], // buyer confirms healthy
  [key(S.DELIVERED, S.REVIEW_WINDOW)]: [R.SYSTEM], // buyer silent → timer
  [key(S.DELIVERED, S.CLAIM_OPEN)]: [R.BUYER],
  [key(S.REVIEW_WINDOW, S.HANDOFF_CONFIRMED)]: [R.SYSTEM], // claim window expiry
  [key(S.REVIEW_WINDOW, S.CLAIM_OPEN)]: [R.BUYER],

  // Pickup handshake (seller verifies the buyer's one-time QR/PIN)
  [key(S.PICKUP_READY, S.HANDOFF_CONFIRMED)]: [R.SELLER, R.SYSTEM],

  // Atomic completion sequence (§8) is SYSTEM-driven
  [key(S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED)]: [R.SYSTEM],
  [key(S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID)]: [R.SYSTEM],
  [key(S.CERTIFICATE_TRANSFERRED, S.COMPLETED)]: [R.SYSTEM], // cash: direct
  [key(S.SELLER_PAID, S.COMPLETED)]: [R.SYSTEM],

  // DOA resolution (curator adjudicates; system may auto-approve full refunds)
  [key(S.CLAIM_OPEN, S.REFUNDED)]: [R.CURATOR, R.SYSTEM],
  [key(S.CLAIM_OPEN, S.PARTIALLY_RESOLVED)]: [R.CURATOR, R.SYSTEM],
  [key(S.CLAIM_OPEN, S.HANDOFF_CONFIRMED)]: [R.CURATOR], // claim denied
  [key(S.PARTIALLY_RESOLVED, S.CERTIFICATE_TRANSFERRED)]: [R.SYSTEM],

  // Reconciliation / recovery (Task 22)
  [key(S.COMPLETED, S.RECONCILIATION)]: [R.OPERATOR, R.CURATOR],
  [key(S.REFUNDED, S.RECONCILIATION)]: [R.OPERATOR, R.CURATOR],
  [key(S.RECONCILIATION, S.REFUNDED)]: [R.OPERATOR, R.CURATOR],
  [key(S.RECONCILIATION, S.DELIVERED)]: [R.OPERATOR, R.CURATOR],
});

/**
 * Roles allowed to trigger a given transition, or [] if none are defined.
 * @param {string} from
 * @param {string} to
 * @returns {string[]}
 */
export function allowedRolesForTransition(from, to) {
  return TRANSITION_PERMISSIONS[key(from, to)] || [];
}

// ─── Identity normalization ──────────────────────────────────────────────────

const lc = (v) => (typeof v === "string" ? v.toLowerCase() : v);

/**
 * @typedef {Object} CanonicalOrderIdentity
 * @property {string} [buyerUserId] - Privy DID captured at checkout
 * @property {string} [buyerWallet]
 * @property {string} [sellerWallet]
 * @property {string} [method] - a FULFILLMENT_METHODS value
 */

/**
 * @typedef {Object} Actor
 * @property {string} [userId] - verified Privy DID (sub claim)
 * @property {string} [walletAddress] - verified wallet (token claim or recovered signer)
 * @property {boolean} [isCurator]
 * @property {boolean} [isOperator]
 * @property {boolean} [isSystem] - authenticated cron/service-role caller
 */

/**
 * Resolve every role an authenticated actor holds for a specific order. An
 * actor may hold more than one (e.g. a curator who is also the buyer); the
 * transition check accepts if ANY held role is permitted.
 *
 * @param {CanonicalOrderIdentity} order
 * @param {Actor} actor
 * @returns {string[]} held roles (possibly empty)
 */
export function resolveActorRoles(order, actor) {
  const roles = new Set();
  if (!order || !actor) return [];

  if (actor.isSystem) roles.add(R.SYSTEM);
  if (actor.isCurator) roles.add(R.CURATOR);
  if (actor.isOperator) roles.add(R.OPERATOR);

  const buyerUserId = order.buyerUserId || null;
  const buyerWallet = lc(order.buyerWallet);
  const sellerWallet = lc(order.sellerWallet);
  const actorWallet = lc(actor.walletAddress);

  // Buyer match: prefer the Privy DID stamped at checkout, else wallet match.
  if (buyerUserId && actor.userId && actor.userId === buyerUserId) {
    roles.add(R.BUYER);
  } else if (actorWallet && buyerWallet && actorWallet === buyerWallet) {
    roles.add(R.BUYER);
  }

  if (actorWallet && sellerWallet && actorWallet === sellerWallet) {
    roles.add(R.SELLER);
  }

  return [...roles];
}

/**
 * The single authorization decision: may this actor move this order from
 * `from` to `to`? Composes the state-machine legality (Task 1) with the
 * per-transition permission matrix (Task 3) and per-order role resolution.
 *
 * @param {CanonicalOrderIdentity} order - carries buyer/seller identity + method
 * @param {string} from - current canonical state
 * @param {string} to - proposed canonical state
 * @param {Actor} actor - authenticated caller
 * @returns {{ allowed: boolean, role?: string, roles: string[], reason?: string }}
 */
export function authorizeTransition(order, from, to, actor) {
  const roles = resolveActorRoles(order, actor);
  if (roles.length === 0) {
    return { allowed: false, roles, reason: "actor holds no role on this order" };
  }

  // State-machine legality first (includes method constraints + terminal/operator gate).
  const isOperator = roles.some((r) => OPERATOR_ROLES.includes(r));
  const legal = isTransitionAllowed(from, to, { method: order.method, isOperator });
  if (!legal.allowed) {
    return { allowed: false, roles, reason: legal.reason };
  }

  // Permission matrix: does any held role permit this transition?
  const permitted = allowedRolesForTransition(from, to);
  const grantingRole = roles.find((r) => permitted.includes(r));
  if (!grantingRole) {
    return {
      allowed: false,
      roles,
      reason: `none of [${roles.join(", ")}] may trigger ${from} → ${to} (requires one of [${permitted.join(", ") || "none"}])`,
    };
  }

  return { allowed: true, role: grantingRole, roles };
}

// ─── Idempotency ─────────────────────────────────────────────────────────────

/**
 * Derive the idempotency key for a money- or certificate-moving transition
 * (§8). Fiat transitions key off the Stripe payment hash; pickup/cash key off
 * the signed one-time handoff-challenge id. The actual dedupe store lives in
 * the persistence layer; this only standardizes the key so all callers agree.
 *
 * @param {CanonicalOrderIdentity & { stripePaymentHash?: string, handoffChallengeId?: string, id?: string }} order
 * @param {string} to - target canonical state
 * @returns {string|null}
 */
export function deriveIdempotencyKey(order, to) {
  if (!order) return null;
  const base = order.stripePaymentHash || order.handoffChallengeId || order.id || null;
  return base ? `${base}:${to}` : null;
}
