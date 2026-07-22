/**
 * Unit tests for orderCopy.js — the Web2 buyer-facing order language module
 * (Task 18, seeding Task 2). See docs/TASK_18_BUYER_ORDERS_SPEC.md §4.
 *
 * Run with: npx vitest --run src/__tests__/orderCopy.test.js
 */

import { describe, it, expect } from "vitest";
import { ORDER_STATES as S, FULFILLMENT_METHODS as M } from "../services/marketplaceStateMachine.js";
import {
  PROHIBITED_TERMS,
  containsProhibitedTerm,
  orderStatusLabel,
  nextActionKind,
  nextActionCopy,
  allowsProblemReport,
  cashNoProtectionDisclosure,
  NEXT_ACTION_KIND,
  TONE,
  SELLER_ACTION_KIND,
  sellerNextActionKind,
  sellerNextActionCopy,
} from "../services/orderCopy.js";

describe("containsProhibitedTerm", () => {
  it("flags known Web3 terms case-insensitively", () => {
    expect(containsProhibitedTerm("Your Wallet is connected")).toBe(true);
    expect(containsProhibitedTerm("NFT transfer complete")).toBe(true);
    expect(containsProhibitedTerm("Gas fees apply")).toBe(true);
    expect(containsProhibitedTerm("Smart Contract executed")).toBe(true);
  });

  it("does not flag safe Web2 language", () => {
    expect(containsProhibitedTerm("Your payment is protected")).toBe(false);
    expect(containsProhibitedTerm("Ownership record transferred")).toBe(false);
    expect(containsProhibitedTerm("Confirmation number: 12345")).toBe(false);
  });
});

describe("Web2 language invariant — every status label is Web3-term-free", () => {
  const allStates = Object.values(S);

  it.each(allStates)("state %s: casual label has no prohibited terms", (state) => {
    const { label } = orderStatusLabel(state, { casual: true });
    expect(containsProhibitedTerm(label), `casual label "${label}" for ${state}`).toBe(false);
  });

  it.each(allStates)("state %s: pro label has no prohibited terms", (state) => {
    const { label } = orderStatusLabel(state, { casual: false });
    expect(containsProhibitedTerm(label), `pro label "${label}" for ${state}`).toBe(false);
  });

  it("every next-action copy (casual + pro) is Web3-term-free across all states/methods", () => {
    const methods = Object.values(M);
    for (const method of methods) {
      for (const state of allStates) {
        const casual = nextActionCopy({ method, canonicalState: state }, { casual: true });
        const pro = nextActionCopy({ method, canonicalState: state }, { casual: false });
        expect(containsProhibitedTerm(casual.copy), `casual next-action "${casual.copy}" (${method}/${state})`).toBe(false);
        expect(containsProhibitedTerm(pro.copy), `pro next-action "${pro.copy}" (${method}/${state})`).toBe(false);
      }
    }
  });

  it("every SELLER next-action copy (casual + pro) is Web3-term-free across all states/methods (Task 19)", () => {
    const methods = Object.values(M);
    for (const method of methods) {
      for (const state of allStates) {
        const casual = sellerNextActionCopy({ method, canonicalState: state }, { casual: true });
        const pro = sellerNextActionCopy({ method, canonicalState: state }, { casual: false });
        expect(containsProhibitedTerm(casual.copy), `casual seller next-action "${casual.copy}" (${method}/${state})`).toBe(false);
        expect(containsProhibitedTerm(pro.copy), `pro seller next-action "${pro.copy}" (${method}/${state})`).toBe(false);
      }
    }
  });

  it("the cash disclosure itself is Web3-term-free", () => {
    expect(containsProhibitedTerm(cashNoProtectionDisclosure({ casual: true }))).toBe(false);
    expect(containsProhibitedTerm(cashNoProtectionDisclosure({ casual: false }))).toBe(false);
  });

  it("PROHIBITED_TERMS is non-empty and includes the plan's avoid-list terms", () => {
    expect(PROHIBITED_TERMS.length).toBeGreaterThan(0);
    for (const t of ["wallet", "nft", "mint", "escrow", "gas", "smart contract"]) {
      expect(PROHIBITED_TERMS).toContain(t);
    }
  });
});

describe("orderStatusLabel", () => {
  it("returns a tone and icon for every known state", () => {
    for (const state of Object.values(S)) {
      const { tone, icon } = orderStatusLabel(state);
      expect(Object.values(TONE)).toContain(tone);
      expect(icon).toBeTruthy();
    }
  });

  it("falls back gracefully for an unknown state", () => {
    const { label, tone } = orderStatusLabel("not_a_real_state");
    expect(label).toBeTruthy();
    expect(Object.values(TONE)).toContain(tone);
  });

  it("alert tone is used for claim_open, refunded, cancelled, non_delivery, reconciliation", () => {
    for (const state of [S.CLAIM_OPEN, S.REFUNDED, S.CANCELLED, S.NON_DELIVERY, S.RECONCILIATION, S.PARTIALLY_RESOLVED]) {
      expect(orderStatusLabel(state).tone).toBe(TONE.ALERT);
    }
  });
});

describe("nextActionKind", () => {
  it("shipping: delivered -> confirm_arrival", () => {
    expect(nextActionKind(M.SHIPPING, S.DELIVERED)).toBe(NEXT_ACTION_KIND.CONFIRM_ARRIVAL);
  });

  it("shipping: in_transit -> track", () => {
    expect(nextActionKind(M.SHIPPING, S.IN_TRANSIT)).toBe(NEXT_ACTION_KIND.TRACK);
  });

  it("courier: in_transit -> track", () => {
    expect(nextActionKind(M.COURIER, S.IN_TRANSIT)).toBe(NEXT_ACTION_KIND.TRACK);
  });

  it("prepaid_pickup: pickup_ready -> show_pickup_code", () => {
    expect(nextActionKind(M.PREPAID_PICKUP, S.PICKUP_READY)).toBe(NEXT_ACTION_KIND.SHOW_PICKUP_CODE);
  });

  it("cash_pickup: pickup_ready -> show_pickup_code", () => {
    expect(nextActionKind(M.CASH_PICKUP, S.PICKUP_READY)).toBe(NEXT_ACTION_KIND.SHOW_PICKUP_CODE);
  });

  it("claim_open -> none for every method", () => {
    for (const method of Object.values(M)) {
      expect(nextActionKind(method, S.CLAIM_OPEN)).toBe(NEXT_ACTION_KIND.NONE);
    }
  });

  it("hasOpenClaim flag forces none even off claim_open state", () => {
    expect(nextActionKind(M.SHIPPING, S.DELIVERED, { hasOpenClaim: true })).toBe(NEXT_ACTION_KIND.NONE);
  });

  it("partially_resolved and refunded -> view_resolution for every method", () => {
    for (const method of Object.values(M)) {
      expect(nextActionKind(method, S.PARTIALLY_RESOLVED)).toBe(NEXT_ACTION_KIND.VIEW_RESOLUTION);
      expect(nextActionKind(method, S.REFUNDED)).toBe(NEXT_ACTION_KIND.VIEW_RESOLUTION);
    }
  });

  it("completed-family states -> view_receipt for every method", () => {
    for (const method of Object.values(M)) {
      for (const state of [S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED]) {
        expect(nextActionKind(method, state)).toBe(NEXT_ACTION_KIND.VIEW_RECEIPT);
      }
    }
  });

  it("cash pickup at delivered-family states never confirms arrival (no DOA workflow)", () => {
    // Cash pickup does not traverse DELIVERED/REVIEW_WINDOW in the canonical
    // graph, but the copy function must still degrade safely if given one.
    expect(nextActionKind(M.CASH_PICKUP, S.DELIVERED)).toBe(NEXT_ACTION_KIND.NONE);
  });
});

describe("sellerNextActionKind (Task 19)", () => {
  it("shipping: payment_protected/preparing -> buy_label", () => {
    expect(sellerNextActionKind(M.SHIPPING, S.PAYMENT_PROTECTED)).toBe(SELLER_ACTION_KIND.BUY_LABEL);
    expect(sellerNextActionKind(M.SHIPPING, S.PREPARING)).toBe(SELLER_ACTION_KIND.BUY_LABEL);
  });

  it("shipping: in_transit -> awaiting_buyer", () => {
    expect(sellerNextActionKind(M.SHIPPING, S.IN_TRANSIT)).toBe(SELLER_ACTION_KIND.AWAITING_BUYER);
  });

  it("courier: payment_protected -> request_courier", () => {
    expect(sellerNextActionKind(M.COURIER, S.PAYMENT_PROTECTED)).toBe(SELLER_ACTION_KIND.REQUEST_COURIER);
  });

  it("prepaid_pickup: payment_protected -> schedule_pickup, pickup_ready -> scan_handoff", () => {
    expect(sellerNextActionKind(M.PREPAID_PICKUP, S.PAYMENT_PROTECTED)).toBe(SELLER_ACTION_KIND.SCHEDULE_PICKUP);
    expect(sellerNextActionKind(M.PREPAID_PICKUP, S.PICKUP_READY)).toBe(SELLER_ACTION_KIND.SCAN_HANDOFF);
  });

  it("cash_pickup: pickup_ready -> confirm_cash", () => {
    expect(sellerNextActionKind(M.CASH_PICKUP, S.PICKUP_READY)).toBe(SELLER_ACTION_KIND.CONFIRM_CASH);
  });

  it("claim_open -> respond_to_claim for every method", () => {
    for (const method of Object.values(M)) {
      expect(sellerNextActionKind(method, S.CLAIM_OPEN)).toBe(SELLER_ACTION_KIND.RESPOND_TO_CLAIM);
    }
  });

  it("hasOpenClaim flag forces respond_to_claim even off claim_open state", () => {
    expect(sellerNextActionKind(M.SHIPPING, S.IN_TRANSIT, { hasOpenClaim: true })).toBe(SELLER_ACTION_KIND.RESPOND_TO_CLAIM);
  });

  it("terminal states -> view_receipt for every method", () => {
    for (const method of Object.values(M)) {
      for (const state of [S.HANDOFF_CONFIRMED, S.CERTIFICATE_TRANSFERRED, S.SELLER_PAID, S.COMPLETED, S.REFUNDED, S.CANCELLED]) {
        expect(sellerNextActionKind(method, state)).toBe(SELLER_ACTION_KIND.VIEW_RECEIPT);
      }
    }
  });

  it("created/payment_pending -> none (payment not yet protected, nothing to act on)", () => {
    expect(sellerNextActionKind(M.SHIPPING, S.CREATED)).toBe(SELLER_ACTION_KIND.NONE);
    expect(sellerNextActionKind(M.SHIPPING, S.PAYMENT_PENDING)).toBe(SELLER_ACTION_KIND.NONE);
  });
});

describe("allowsProblemReport — cash has no DOA protection", () => {
  it("cash_pickup never allows a problem report", () => {
    expect(allowsProblemReport(M.CASH_PICKUP)).toBe(false);
  });

  it("every other method allows a problem report", () => {
    expect(allowsProblemReport(M.SHIPPING)).toBe(true);
    expect(allowsProblemReport(M.COURIER)).toBe(true);
    expect(allowsProblemReport(M.PREPAID_PICKUP)).toBe(true);
  });
});

describe("cashNoProtectionDisclosure", () => {
  it("returns non-empty copy in both casual and pro modes", () => {
    expect(cashNoProtectionDisclosure({ casual: true }).length).toBeGreaterThan(0);
    expect(cashNoProtectionDisclosure({ casual: false }).length).toBeGreaterThan(0);
  });
});
