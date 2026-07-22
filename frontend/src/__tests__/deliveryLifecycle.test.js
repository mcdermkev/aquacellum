/**
 * Unit tests for deliveryLifecycle.js — the pure timing/decision logic for the
 * delivery-gated release model (Task 16). See docs/MARKETPLACE_STATE_MODEL.md
 * §5.1 (shipping path), §9 (guards), and the plan's "Delivery-gated release".
 *
 * Run with: npx vitest --run src/__tests__/deliveryLifecycle.test.js
 */

import { describe, it, expect } from "vitest";
import { ORDER_STATES as S, FULFILLMENT_METHODS as M } from "../services/marketplaceStateMachine.js";
import { DEFAULT_CLAIM_WINDOW_MS } from "../services/doaClaims.js";
import {
  MAX_TRANSIT_WINDOW_MS,
  maxTransitWindowMs,
  evaluateAutoAdvance,
  AUTO_ADVANCE,
} from "../services/deliveryLifecycle.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_000_000_000_000; // fixed epoch base for deterministic tests

describe("max transit windows", () => {
  it("shipping is generous (10 days), courier is tight (1 day)", () => {
    expect(MAX_TRANSIT_WINDOW_MS[M.SHIPPING]).toBe(10 * DAY);
    expect(MAX_TRANSIT_WINDOW_MS[M.COURIER]).toBe(1 * DAY);
  });

  it("maxTransitWindowMs returns null for methods with no transit phase", () => {
    expect(maxTransitWindowMs(M.PREPAID_PICKUP)).toBeNull();
    expect(maxTransitWindowMs(M.CASH_PICKUP)).toBeNull();
    expect(maxTransitWindowMs(M.SHIPPING)).toBe(10 * DAY);
  });
});

describe("in_transit → non_delivery on transit-window expiry", () => {
  it("stays NONE within the shipping transit window", () => {
    const d = evaluateAutoAdvance({ state: S.IN_TRANSIT, method: M.SHIPPING, dispatchedAt: T0, now: T0 + 9 * DAY });
    expect(d.action).toBe(AUTO_ADVANCE.NONE);
  });

  it("moves to NON_DELIVERY once the shipping window elapses", () => {
    const d = evaluateAutoAdvance({ state: S.IN_TRANSIT, method: M.SHIPPING, dispatchedAt: T0, now: T0 + 10 * DAY + 1 });
    expect(d.action).toBe(AUTO_ADVANCE.NON_DELIVERY);
  });

  it("courier trips non-delivery far sooner (1 day)", () => {
    expect(evaluateAutoAdvance({ state: S.IN_TRANSIT, method: M.COURIER, dispatchedAt: T0, now: T0 + 12 * 60 * 60 * 1000 }).action).toBe(AUTO_ADVANCE.NONE);
    expect(evaluateAutoAdvance({ state: S.IN_TRANSIT, method: M.COURIER, dispatchedAt: T0, now: T0 + DAY + 1 }).action).toBe(AUTO_ADVANCE.NON_DELIVERY);
  });

  it("never non-delivers without a dispatch anchor", () => {
    const d = evaluateAutoAdvance({ state: S.IN_TRANSIT, method: M.SHIPPING, dispatchedAt: null, now: T0 + 100 * DAY });
    expect(d.action).toBe(AUTO_ADVANCE.NONE);
  });
});

describe("delivered/review_window → auto_complete on claim-window expiry", () => {
  it("stays NONE within the default 48h claim window", () => {
    const d = evaluateAutoAdvance({ state: S.DELIVERED, method: M.SHIPPING, deliveredAt: T0, now: T0 + DEFAULT_CLAIM_WINDOW_MS - 1 });
    expect(d.action).toBe(AUTO_ADVANCE.NONE);
  });

  it("auto-completes once the claim window elapses with no claim", () => {
    const d = evaluateAutoAdvance({ state: S.DELIVERED, method: M.SHIPPING, deliveredAt: T0, now: T0 + DEFAULT_CLAIM_WINDOW_MS + 1 });
    expect(d.action).toBe(AUTO_ADVANCE.AUTO_COMPLETE);
  });

  it("applies from review_window too", () => {
    const d = evaluateAutoAdvance({ state: S.REVIEW_WINDOW, method: M.SHIPPING, deliveredAt: T0, now: T0 + DEFAULT_CLAIM_WINDOW_MS + 1 });
    expect(d.action).toBe(AUTO_ADVANCE.AUTO_COMPLETE);
  });

  it("respects a seller's LONGER claim window (never shorter than the platform min)", () => {
    const sellerWindow = 5 * DAY;
    // Past the platform min but inside the seller's extended window → still NONE.
    const inside = evaluateAutoAdvance({ state: S.DELIVERED, method: M.SHIPPING, deliveredAt: T0, now: T0 + 3 * DAY, sellerPolicyWindowMs: sellerWindow });
    expect(inside.action).toBe(AUTO_ADVANCE.NONE);
    // Past the seller's window → auto-complete.
    const past = evaluateAutoAdvance({ state: S.DELIVERED, method: M.SHIPPING, deliveredAt: T0, now: T0 + 5 * DAY + 1, sellerPolicyWindowMs: sellerWindow });
    expect(past.action).toBe(AUTO_ADVANCE.AUTO_COMPLETE);
  });

  it("a shorter seller window is floored at the platform minimum", () => {
    const d = evaluateAutoAdvance({ state: S.DELIVERED, method: M.SHIPPING, deliveredAt: T0, now: T0 + DEFAULT_CLAIM_WINDOW_MS - 1, sellerPolicyWindowMs: 1 * 60 * 60 * 1000 });
    expect(d.action).toBe(AUTO_ADVANCE.NONE); // still inside the 48h floor
  });

  it("never auto-completes without a delivery anchor", () => {
    const d = evaluateAutoAdvance({ state: S.DELIVERED, method: M.SHIPPING, deliveredAt: null, now: T0 + 100 * DAY });
    expect(d.action).toBe(AUTO_ADVANCE.NONE);
  });
});

describe("an open claim freezes all auto-advance", () => {
  it("never non-delivers a claimed order", () => {
    const d = evaluateAutoAdvance({ state: S.IN_TRANSIT, method: M.SHIPPING, dispatchedAt: T0, now: T0 + 100 * DAY, hasOpenClaim: true });
    expect(d.action).toBe(AUTO_ADVANCE.NONE);
    expect(d.reason).toMatch(/claim/i);
  });

  it("never auto-completes a claimed order", () => {
    const d = evaluateAutoAdvance({ state: S.DELIVERED, method: M.SHIPPING, deliveredAt: T0, now: T0 + 100 * DAY, hasOpenClaim: true });
    expect(d.action).toBe(AUTO_ADVANCE.NONE);
  });
});

describe("methods without a transit/claim lifecycle", () => {
  it.each([M.PREPAID_PICKUP, M.CASH_PICKUP])("%s never auto-advances", (method) => {
    expect(evaluateAutoAdvance({ state: S.IN_TRANSIT, method, dispatchedAt: T0, now: T0 + 100 * DAY }).action).toBe(AUTO_ADVANCE.NONE);
    expect(evaluateAutoAdvance({ state: S.DELIVERED, method, deliveredAt: T0, now: T0 + 100 * DAY }).action).toBe(AUTO_ADVANCE.NONE);
  });
});

describe("non_delivery never auto-advances by time (§9)", () => {
  it("stays NONE regardless of elapsed time (requires a delivery event or reconciliation)", () => {
    const d = evaluateAutoAdvance({ state: S.NON_DELIVERY, method: M.SHIPPING, dispatchedAt: T0, deliveredAt: null, now: T0 + 100 * DAY });
    expect(d.action).toBe(AUTO_ADVANCE.NONE);
  });
});

describe("determinism", () => {
  it("identical inputs yield identical decisions", () => {
    const args = { state: S.IN_TRANSIT, method: M.SHIPPING, dispatchedAt: T0, now: T0 + 11 * DAY };
    expect(evaluateAutoAdvance(args)).toEqual(evaluateAutoAdvance(args));
  });
});
