/**
 * Unit tests for the canonical order authorization boundary (Task 3).
 *
 * Verifies role resolution per order and that authorizeTransition composes the
 * state-machine legality with the per-transition permission matrix, matching
 * the real rules today's handlers enforce ad hoc (buyer confirms arrival,
 * seller dispatches, system runs webhooks/cron, curator resolves disputes).
 *
 * Run with: npx vitest --run src/__tests__/orderAuthorization.test.js
 */

import { describe, it, expect } from "vitest";
import { FULFILLMENT_METHODS, ORDER_STATES } from "../services/marketplaceStateMachine.js";
import {
  ACTOR_ROLES,
  allowedRolesForTransition,
  resolveActorRoles,
  authorizeTransition,
  deriveIdempotencyKey,
} from "../services/orderAuthorization.js";

const S = ORDER_STATES;
const R = ACTOR_ROLES;
const M = FULFILLMENT_METHODS;

const shippingOrder = {
  buyerUserId: "did:privy:buyer123",
  buyerWallet: "0xBUYER",
  sellerWallet: "0xSELLER",
  method: M.SHIPPING,
};

const buyerActor = { userId: "did:privy:buyer123" };
const buyerByWallet = { walletAddress: "0xbuyer" };
const sellerActor = { walletAddress: "0xseller" };
const curatorActor = { isCurator: true };
const systemActor = { isSystem: true };
const operatorActor = { isOperator: true };
const strangerActor = { userId: "did:privy:someone-else", walletAddress: "0xdead" };

describe("resolveActorRoles", () => {
  it("matches the buyer by Privy DID", () => {
    expect(resolveActorRoles(shippingOrder, buyerActor)).toEqual([R.BUYER]);
  });

  it("matches the buyer by wallet (case-insensitive) when no DID match", () => {
    expect(resolveActorRoles(shippingOrder, buyerByWallet)).toEqual([R.BUYER]);
  });

  it("matches the seller by wallet (case-insensitive)", () => {
    expect(resolveActorRoles(shippingOrder, sellerActor)).toEqual([R.SELLER]);
  });

  it("recognizes system, curator, and operator flags", () => {
    expect(resolveActorRoles(shippingOrder, systemActor)).toEqual([R.SYSTEM]);
    expect(resolveActorRoles(shippingOrder, curatorActor)).toEqual([R.CURATOR]);
    expect(resolveActorRoles(shippingOrder, operatorActor)).toEqual([R.OPERATOR]);
  });

  it("can hold multiple roles (curator who is also the buyer)", () => {
    const roles = resolveActorRoles(shippingOrder, { isCurator: true, userId: "did:privy:buyer123" });
    expect(roles).toContain(R.CURATOR);
    expect(roles).toContain(R.BUYER);
  });

  it("returns no roles for a stranger", () => {
    expect(resolveActorRoles(shippingOrder, strangerActor)).toEqual([]);
  });

  it("does not match buyer by wallet when a different DID is stamped and wallets differ", () => {
    expect(resolveActorRoles(shippingOrder, { userId: "did:privy:other" })).toEqual([]);
  });
});

describe("authorizeTransition — happy-path roles", () => {
  it("system confirms payment protected", () => {
    expect(authorizeTransition(shippingOrder, S.PAYMENT_PENDING, S.PAYMENT_PROTECTED, systemActor).allowed).toBe(true);
  });

  it("seller dispatches (preparing → in_transit)", () => {
    const res = authorizeTransition(shippingOrder, S.PREPARING, S.IN_TRANSIT, sellerActor);
    expect(res.allowed).toBe(true);
    expect(res.role).toBe(R.SELLER);
  });

  it("system records delivery; buyer confirms healthy arrival", () => {
    expect(authorizeTransition(shippingOrder, S.IN_TRANSIT, S.DELIVERED, systemActor).allowed).toBe(true);
    expect(authorizeTransition(shippingOrder, S.DELIVERED, S.HANDOFF_CONFIRMED, buyerActor).allowed).toBe(true);
  });

  it("system runs the atomic completion sequence", () => {
    expect(authorizeTransition(shippingOrder, S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, systemActor).allowed).toBe(true);
    expect(authorizeTransition(shippingOrder, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, systemActor).allowed).toBe(true);
    expect(authorizeTransition(shippingOrder, S.SELLER_PAID, S.COMPLETED, systemActor).allowed).toBe(true);
  });
});

describe("authorizeTransition — denials", () => {
  it("denies a stranger everything", () => {
    const res = authorizeTransition(shippingOrder, S.DELIVERED, S.HANDOFF_CONFIRMED, strangerActor);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/no role/);
  });

  it("seller cannot confirm the buyer's healthy arrival", () => {
    const res = authorizeTransition(shippingOrder, S.DELIVERED, S.HANDOFF_CONFIRMED, sellerActor);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/may trigger/);
  });

  it("buyer cannot mark their own order as paid to the seller", () => {
    expect(authorizeTransition(shippingOrder, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, buyerActor).allowed).toBe(false);
  });

  it("seller cannot self-confirm delivery (carrier event is system-only)", () => {
    expect(authorizeTransition(shippingOrder, S.IN_TRANSIT, S.DELIVERED, sellerActor).allowed).toBe(false);
  });

  it("buyer cannot open a claim on a state that is not delivered/review/non_delivery", () => {
    // preparing → claim_open is not a legal edge at all
    const res = authorizeTransition(shippingOrder, S.PREPARING, S.CLAIM_OPEN, buyerActor);
    expect(res.allowed).toBe(false);
  });
});

describe("authorizeTransition — DOA and claims", () => {
  it("buyer opens a DOA claim from delivered", () => {
    expect(authorizeTransition(shippingOrder, S.DELIVERED, S.CLAIM_OPEN, buyerActor).allowed).toBe(true);
  });

  it("buyer reports never-received from non_delivery", () => {
    expect(authorizeTransition(shippingOrder, S.NON_DELIVERY, S.CLAIM_OPEN, buyerActor).allowed).toBe(true);
  });

  it("curator resolves a claim (refund / partial / deny), buyer cannot", () => {
    expect(authorizeTransition(shippingOrder, S.CLAIM_OPEN, S.REFUNDED, curatorActor).allowed).toBe(true);
    expect(authorizeTransition(shippingOrder, S.CLAIM_OPEN, S.PARTIALLY_RESOLVED, curatorActor).allowed).toBe(true);
    expect(authorizeTransition(shippingOrder, S.CLAIM_OPEN, S.HANDOFF_CONFIRMED, curatorActor).allowed).toBe(true);
    expect(authorizeTransition(shippingOrder, S.CLAIM_OPEN, S.REFUNDED, buyerActor).allowed).toBe(false);
  });
});

describe("authorizeTransition — cash pickup constraints", () => {
  const cashOrder = { buyerWallet: "0xbuyer", sellerWallet: "0xseller", method: M.CASH_PICKUP };

  it("seller confirms the handoff", () => {
    expect(authorizeTransition(cashOrder, S.PICKUP_READY, S.HANDOFF_CONFIRMED, sellerActor).allowed).toBe(true);
  });

  it("never routes a platform payout (state-machine level)", () => {
    const res = authorizeTransition(cashOrder, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, systemActor);
    expect(res.allowed).toBe(false);
  });

  it("completes directly after certificate transfer", () => {
    expect(authorizeTransition(cashOrder, S.CERTIFICATE_TRANSFERRED, S.COMPLETED, systemActor).allowed).toBe(true);
  });
});

describe("authorizeTransition — reconciliation / terminal reopen", () => {
  it("operator or curator may reopen a completed order into reconciliation", () => {
    expect(authorizeTransition(shippingOrder, S.COMPLETED, S.RECONCILIATION, operatorActor).allowed).toBe(true);
    expect(authorizeTransition(shippingOrder, S.COMPLETED, S.RECONCILIATION, curatorActor).allowed).toBe(true);
  });

  it("system alone cannot reopen a terminal order (isOperator gate)", () => {
    const res = authorizeTransition(shippingOrder, S.COMPLETED, S.RECONCILIATION, systemActor);
    expect(res.allowed).toBe(false);
  });

  it("buyer cannot reopen a terminal order", () => {
    expect(authorizeTransition(shippingOrder, S.COMPLETED, S.RECONCILIATION, buyerActor).allowed).toBe(false);
  });
});

describe("allowedRolesForTransition", () => {
  it("returns the configured roles", () => {
    expect(allowedRolesForTransition(S.DELIVERED, S.HANDOFF_CONFIRMED)).toEqual([R.BUYER]);
    expect(allowedRolesForTransition(S.IN_TRANSIT, S.DELIVERED)).toEqual([R.SYSTEM]);
  });

  it("returns [] for undefined transitions", () => {
    expect(allowedRolesForTransition(S.CREATED, S.COMPLETED)).toEqual([]);
  });
});

describe("deriveIdempotencyKey", () => {
  it("prefers the stripe payment hash", () => {
    expect(deriveIdempotencyKey({ stripePaymentHash: "0xhash", id: "o1" }, S.SELLER_PAID)).toBe("0xhash:seller_paid");
  });

  it("falls back to the handoff challenge id, then order id", () => {
    expect(deriveIdempotencyKey({ handoffChallengeId: "chal1" }, S.HANDOFF_CONFIRMED)).toBe("chal1:handoff_confirmed");
    expect(deriveIdempotencyKey({ id: "o9" }, S.CERTIFICATE_TRANSFERRED)).toBe("o9:certificate_transferred");
  });

  it("returns null when nothing identifies the order", () => {
    expect(deriveIdempotencyKey({}, S.COMPLETED)).toBeNull();
  });
});
