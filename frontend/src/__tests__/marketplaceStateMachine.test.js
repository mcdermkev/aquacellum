/**
 * Unit tests for the canonical marketplace state machine.
 *
 * Verifies the states, per-fulfillment-path transitions, and guard rules from
 * docs/MARKETPLACE_STATE_MODEL.md §5 and §9 — the "tested state-transition
 * table" that is Task 1's demo deliverable.
 *
 * Run with: npx vitest --run src/__tests__/marketplaceStateMachine.test.js
 */

import { describe, it, expect } from "vitest";
import {
  FULFILLMENT_METHODS,
  ORDER_STATES,
  TERMINAL_STATES,
  LINE_ITEM_STATES,
  STATE_POSITIONS,
  isTransitionAllowed,
  isStateValidForMethod,
  reachableStatesForMethod,
  isCancellable,
  legacyCloudStatusToCanonical,
} from "../services/marketplaceStateMachine.js";

const M = FULFILLMENT_METHODS;
const S = ORDER_STATES;

/** Walk a path, asserting every consecutive transition is allowed for method. */
function assertPathAllowed(path, method) {
  for (let i = 0; i < path.length - 1; i++) {
    const res = isTransitionAllowed(path[i], path[i + 1], { method });
    expect(res, `${path[i]} → ${path[i + 1]} for ${method}: ${res.reason || ""}`).toMatchObject({ allowed: true });
  }
}

describe("state/position integrity", () => {
  it("every order state has a documented position triple", () => {
    for (const state of Object.values(ORDER_STATES)) {
      expect(STATE_POSITIONS[state], `missing positions for ${state}`).toBeDefined();
      expect(STATE_POSITIONS[state]).toHaveProperty("money");
      expect(STATE_POSITIONS[state]).toHaveProperty("certificate");
      expect(STATE_POSITIONS[state]).toHaveProperty("inventory");
    }
  });

  it("terminal states are completed, refunded, cancelled", () => {
    expect([...TERMINAL_STATES].sort()).toEqual(
      [S.COMPLETED, S.REFUNDED, S.CANCELLED].sort()
    );
  });

  it("defines the seven line-item states", () => {
    expect(Object.values(LINE_ITEM_STATES)).toEqual([
      "pending", "healthy", "doa_claimed", "refunded",
      "replacement_pending", "replaced", "denied",
    ]);
  });
});

describe("§5.1 nationwide shipping happy path", () => {
  it("created → … → completed", () => {
    assertPathAllowed(
      [S.CREATED, S.PAYMENT_PENDING, S.PAYMENT_PROTECTED, S.PREPARING, S.IN_TRANSIT,
       S.DELIVERED, S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED],
      M.SHIPPING
    );
  });

  it("supports the silent-buyer auto-complete branch via review_window", () => {
    assertPathAllowed([S.DELIVERED, S.REVIEW_WINDOW, S.HANDOFF_CONFIRMED], M.SHIPPING);
  });
});

describe("§5.1 non-delivery branch", () => {
  it("in_transit → non_delivery when no delivery event", () => {
    expect(isTransitionAllowed(S.IN_TRANSIT, S.NON_DELIVERY, { method: M.SHIPPING }).allowed).toBe(true);
  });

  it("non_delivery → delivered on a late event, and → reconciliation on escalation", () => {
    expect(isTransitionAllowed(S.NON_DELIVERY, S.DELIVERED, { method: M.SHIPPING }).allowed).toBe(true);
    expect(isTransitionAllowed(S.NON_DELIVERY, S.RECONCILIATION, { method: M.SHIPPING }).allowed).toBe(true);
  });

  it("non_delivery never auto-completes on elapsed time (§9)", () => {
    expect(isTransitionAllowed(S.NON_DELIVERY, S.COMPLETED, { method: M.SHIPPING }).allowed).toBe(false);
    expect(isTransitionAllowed(S.NON_DELIVERY, S.HANDOFF_CONFIRMED, { method: M.SHIPPING }).allowed).toBe(false);
  });
});

describe("§5.3 prepaid pickup happy path", () => {
  it("created → … → completed via pickup_ready", () => {
    assertPathAllowed(
      [S.CREATED, S.PAYMENT_PENDING, S.PAYMENT_PROTECTED, S.PREPARING, S.PICKUP_READY,
       S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED],
      M.PREPAID_PICKUP
    );
  });

  it("has no transit/delivery states", () => {
    expect(isStateValidForMethod(S.IN_TRANSIT, M.PREPAID_PICKUP)).toBe(false);
    expect(isStateValidForMethod(S.DELIVERED, M.PREPAID_PICKUP)).toBe(false);
  });
});

describe("§5.4 cash pickup happy path", () => {
  it("created → pickup_ready → handoff_confirmed → certificate_transferred → completed", () => {
    assertPathAllowed(
      [S.CREATED, S.PICKUP_READY, S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.COMPLETED],
      M.CASH_PICKUP
    );
  });

  it("never enters payment states or a platform payout (§9)", () => {
    expect(isTransitionAllowed(S.CREATED, S.PAYMENT_PENDING, { method: M.CASH_PICKUP }).allowed).toBe(false);
    expect(isStateValidForMethod(S.PAYMENT_PROTECTED, M.CASH_PICKUP)).toBe(false);
    expect(isTransitionAllowed(S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, { method: M.CASH_PICKUP }).allowed).toBe(false);
  });

  it("completes directly from certificate_transferred (no seller_paid)", () => {
    expect(isTransitionAllowed(S.CERTIFICATE_TRANSFERRED, S.COMPLETED, { method: M.CASH_PICKUP }).allowed).toBe(true);
  });
});

describe("§5.5 DOA and replacement", () => {
  it("delivered/review_window → claim_open", () => {
    expect(isTransitionAllowed(S.DELIVERED, S.CLAIM_OPEN, { method: M.SHIPPING }).allowed).toBe(true);
    expect(isTransitionAllowed(S.REVIEW_WINDOW, S.CLAIM_OPEN, { method: M.SHIPPING }).allowed).toBe(true);
  });

  it("claim_open resolves to refunded, partially_resolved, or denied (→ handoff_confirmed)", () => {
    expect(isTransitionAllowed(S.CLAIM_OPEN, S.REFUNDED, { method: M.SHIPPING }).allowed).toBe(true);
    expect(isTransitionAllowed(S.CLAIM_OPEN, S.PARTIALLY_RESOLVED, { method: M.SHIPPING }).allowed).toBe(true);
    expect(isTransitionAllowed(S.CLAIM_OPEN, S.HANDOFF_CONFIRMED, { method: M.SHIPPING }).allowed).toBe(true);
  });

  it("partially_resolved transfers healthy certificates", () => {
    expect(isTransitionAllowed(S.PARTIALLY_RESOLVED, S.CERTIFICATE_TRANSFERRED, { method: M.SHIPPING }).allowed).toBe(true);
  });

  it("claim_open cannot jump straight to seller payout (§9 frozen payout)", () => {
    expect(isTransitionAllowed(S.CLAIM_OPEN, S.SELLER_PAID, { method: M.SHIPPING }).allowed).toBe(false);
  });
});

describe("§9 guard rules", () => {
  it("rejects skipping delivery: in_transit → handoff_confirmed", () => {
    expect(isTransitionAllowed(S.IN_TRANSIT, S.HANDOFF_CONFIRMED, { method: M.SHIPPING }).allowed).toBe(false);
  });

  it("rejects certificate transfer before payment", () => {
    expect(isTransitionAllowed(S.CREATED, S.CERTIFICATE_TRANSFERRED, { method: M.SHIPPING }).allowed).toBe(false);
    expect(isTransitionAllowed(S.PAYMENT_PENDING, S.CERTIFICATE_TRANSFERRED, { method: M.SHIPPING }).allowed).toBe(false);
  });

  it("rejects no-op transitions", () => {
    expect(isTransitionAllowed(S.DELIVERED, S.DELIVERED, { method: M.SHIPPING }).allowed).toBe(false);
  });

  it("rejects unknown states and methods", () => {
    expect(isTransitionAllowed("bogus", S.COMPLETED).allowed).toBe(false);
    expect(isTransitionAllowed(S.CREATED, "bogus").allowed).toBe(false);
    expect(isTransitionAllowed(S.CREATED, S.PAYMENT_PENDING, { method: "teleport" }).allowed).toBe(false);
  });

  it("terminal states only reopen into reconciliation, and only for operators", () => {
    for (const t of TERMINAL_STATES) {
      expect(isTransitionAllowed(t, S.PREPARING).allowed).toBe(false);
    }
    // completed → reconciliation requires operator
    expect(isTransitionAllowed(S.COMPLETED, S.RECONCILIATION, { isOperator: false }).allowed).toBe(false);
    expect(isTransitionAllowed(S.COMPLETED, S.RECONCILIATION, { isOperator: true }).allowed).toBe(true);
    // cancelled is fully terminal (no outbound edges at all)
    expect(isTransitionAllowed(S.CANCELLED, S.RECONCILIATION, { isOperator: true }).allowed).toBe(false);
  });
});

describe("cancellation (§5.6)", () => {
  it("is allowed before fulfillment begins", () => {
    expect(isCancellable(S.CREATED)).toBe(true);
    expect(isCancellable(S.PAYMENT_PENDING)).toBe(true);
    expect(isCancellable(S.PAYMENT_PROTECTED)).toBe(true);
  });

  it("is not a bare option after preparing", () => {
    expect(isCancellable(S.PREPARING)).toBe(false);
    expect(isCancellable(S.IN_TRANSIT)).toBe(false);
    expect(isCancellable(S.DELIVERED)).toBe(false);
  });
});

describe("reachableStatesForMethod", () => {
  it("shipping excludes pickup_ready; cash excludes payment + transit + payout", () => {
    const shipping = reachableStatesForMethod(M.SHIPPING);
    expect(shipping).not.toContain(S.PICKUP_READY);
    expect(shipping).toContain(S.IN_TRANSIT);

    const cash = reachableStatesForMethod(M.CASH_PICKUP);
    expect(cash).not.toContain(S.PAYMENT_PROTECTED);
    expect(cash).not.toContain(S.SELLER_PAID);
    expect(cash).not.toContain(S.IN_TRANSIT);
    expect(cash).toContain(S.PICKUP_READY);
  });
});

describe("§6 legacy → canonical mapping", () => {
  it("maps representative legacy cloud statuses", () => {
    expect(legacyCloudStatusToCanonical("pending")).toBe(S.CREATED);
    expect(legacyCloudStatusToCanonical("locked")).toBe(S.PAYMENT_PROTECTED);
    expect(legacyCloudStatusToCanonical("dispatched")).toBe(S.IN_TRANSIT);
    expect(legacyCloudStatusToCanonical("released")).toBe(S.CERTIFICATE_TRANSFERRED);
    expect(legacyCloudStatusToCanonical("resolved_released")).toBe(S.SELLER_PAID);
    expect(legacyCloudStatusToCanonical("settled")).toBe(S.COMPLETED);
    expect(legacyCloudStatusToCanonical("completed")).toBe(S.COMPLETED);
    expect(legacyCloudStatusToCanonical("disputed")).toBe(S.CLAIM_OPEN);
    expect(legacyCloudStatusToCanonical("refunded")).toBe(S.REFUNDED);
    expect(legacyCloudStatusToCanonical("failed")).toBe(S.CANCELLED);
  });

  it("returns null for unrecognized legacy statuses", () => {
    expect(legacyCloudStatusToCanonical("bogus")).toBeNull();
    expect(legacyCloudStatusToCanonical(undefined)).toBeNull();
  });
});
