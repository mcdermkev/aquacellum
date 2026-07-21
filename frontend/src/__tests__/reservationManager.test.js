/**
 * Unit tests for the inventory reservation manager (Task 13).
 *
 * Covers the TTL lifecycle and oversell prevention with a deterministic
 * injected clock: expiry frees stock, committing stops expiry, availability
 * math, and the reserve/extend/commit/consume/release transitions.
 *
 * Run with: npx vitest --run src/__tests__/reservationManager.test.js
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_ONLINE_TTL_MS,
  DEFAULT_CASH_TTL_MS,
  RESERVATION_KIND,
  RESERVATION_STATES as S,
  createReservation,
  effectiveState,
  availableQuantity,
  canReserve,
  extend,
  commit,
  consume,
  release,
} from "../services/reservationManager.js";

const T0 = 1_000_000_000_000; // fixed epoch ms

describe("createReservation", () => {
  it("creates a RESERVED hold with the online TTL by default", () => {
    const r = createReservation({ id: "r1", sku: "5", quantity: 1, now: T0 });
    expect(r.state).toBe(S.RESERVED);
    expect(r.expiresAt).toBe(T0 + DEFAULT_ONLINE_TTL_MS);
  });

  it("uses the longer cash TTL for cash reservations", () => {
    const r = createReservation({ id: "r1", sku: "5", quantity: 1, now: T0, kind: RESERVATION_KIND.CASH });
    expect(r.expiresAt).toBe(T0 + DEFAULT_CASH_TTL_MS);
  });

  it("honors an explicit ttl override (seller-configurable cash meet)", () => {
    const r = createReservation({ id: "r1", sku: "5", quantity: 1, now: T0, kind: RESERVATION_KIND.CASH, ttlMs: 3600000 });
    expect(r.expiresAt).toBe(T0 + 3600000);
  });
});

describe("effectiveState — lazy expiry", () => {
  it("reports EXPIRED once a reserved hold's TTL elapses", () => {
    const r = createReservation({ id: "r1", sku: "5", quantity: 1, now: T0 });
    expect(effectiveState(r, T0 + DEFAULT_ONLINE_TTL_MS - 1)).toBe(S.RESERVED);
    expect(effectiveState(r, T0 + DEFAULT_ONLINE_TTL_MS)).toBe(S.EXPIRED);
  });

  it("a committed hold never expires", () => {
    const r = commit(createReservation({ id: "r1", sku: "5", quantity: 1, now: T0 }), T0).reservation;
    expect(effectiveState(r, T0 + DEFAULT_CASH_TTL_MS * 10)).toBe(S.COMMITTED);
  });
});

describe("availableQuantity + canReserve (oversell prevention)", () => {
  it("subtracts active reserved holds from stock", () => {
    const reservations = [createReservation({ id: "r1", sku: "5", quantity: 2, now: T0 })];
    expect(availableQuantity(3, reservations, "5", T0)).toBe(1);
    expect(canReserve(3, reservations, "5", 1, T0)).toBe(true);
    expect(canReserve(3, reservations, "5", 2, T0)).toBe(false);
  });

  it("frees stock again once a reserved hold expires (no background job needed)", () => {
    const reservations = [createReservation({ id: "r1", sku: "5", quantity: 3, now: T0 })];
    expect(availableQuantity(3, reservations, "5", T0)).toBe(0);
    const afterExpiry = T0 + DEFAULT_ONLINE_TTL_MS;
    expect(availableQuantity(3, reservations, "5", afterExpiry)).toBe(3);
  });

  it("committed and consumed holds still count as unavailable", () => {
    const committed = commit(createReservation({ id: "r1", sku: "5", quantity: 1, now: T0 }), T0).reservation;
    const consumed = consume(commit(createReservation({ id: "r2", sku: "5", quantity: 1, now: T0 }), T0).reservation).reservation;
    // Even far in the future, these hold stock.
    const future = T0 + DEFAULT_CASH_TTL_MS * 5;
    expect(availableQuantity(3, [committed, consumed], "5", future)).toBe(1);
  });

  it("released holds free their stock", () => {
    const released = release(createReservation({ id: "r1", sku: "5", quantity: 2, now: T0 }), T0).reservation;
    expect(availableQuantity(3, [released], "5", T0)).toBe(3);
  });

  it("scopes availability by sku", () => {
    const reservations = [createReservation({ id: "r1", sku: "5", quantity: 2, now: T0 })];
    expect(availableQuantity(3, reservations, "9", T0)).toBe(3); // different sku unaffected
  });
});

describe("transitions", () => {
  it("extend pushes out a reserved hold's expiry", () => {
    const r = createReservation({ id: "r1", sku: "5", quantity: 1, now: T0 });
    const res = extend(r, 60000, T0 + 1000);
    expect(res.ok).toBe(true);
    expect(res.reservation.expiresAt).toBe(r.expiresAt + 60000);
  });

  it("cannot extend an expired hold", () => {
    const r = createReservation({ id: "r1", sku: "5", quantity: 1, now: T0 });
    const res = extend(r, 60000, T0 + DEFAULT_ONLINE_TTL_MS);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/expired/);
  });

  it("commit clears the TTL; cannot commit an expired hold", () => {
    const r = createReservation({ id: "r1", sku: "5", quantity: 1, now: T0 });
    const ok = commit(r, T0 + 1000);
    expect(ok.ok).toBe(true);
    expect(ok.reservation.state).toBe(S.COMMITTED);
    expect(ok.reservation.expiresAt).toBeNull();

    const late = commit(r, T0 + DEFAULT_ONLINE_TTL_MS);
    expect(late.ok).toBe(false);
  });

  it("consume only from committed", () => {
    const reserved = createReservation({ id: "r1", sku: "5", quantity: 1, now: T0 });
    expect(consume(reserved).ok).toBe(false);
    const committed = commit(reserved, T0).reservation;
    expect(consume(committed).reservation.state).toBe(S.CONSUMED);
  });

  it("release from reserved or committed, not from consumed", () => {
    const reserved = createReservation({ id: "r1", sku: "5", quantity: 1, now: T0 });
    expect(release(reserved, T0).reservation.state).toBe(S.RELEASED);
    const consumed = consume(commit(reserved, T0).reservation).reservation;
    expect(release(consumed, T0).ok).toBe(false);
  });

  it("transitions never mutate the input record", () => {
    const r = createReservation({ id: "r1", sku: "5", quantity: 1, now: T0 });
    commit(r, T0);
    expect(r.state).toBe(S.RESERVED); // unchanged
  });
});
