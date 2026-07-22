/**
 * Unit tests for reservationService (the wiring layer) using an in-memory store
 * whose reserveAtomic mirrors the reserve_stock() Postgres function: active
 * holds (reserved-not-expired + committed + consumed) subtract from on-hand
 * stock, and a request that would exceed stock is rejected as oversell.
 *
 * Proves the reservation lifecycle (MARKETPLACE_STATE_MODEL.md §7) persists
 * correctly without a database: reserve → commit → consume, TTL expiry frees
 * stock, oversell is prevented, and release returns stock.
 *
 * Run with: npx vitest --run src/__tests__/reservationService.test.js
 */

import { describe, it, expect } from "vitest";
import {
  reserve, extend, commit, consume, release, availability, currentState,
  RESERVATION_KIND, DEFAULT_ONLINE_TTL_MS, DEFAULT_CASH_TTL_MS,
} from "../services/reservationService.js";
import { RESERVATION_STATES } from "../services/reservationManager.js";

/** In-memory store that emulates the DB's atomic reserve + held arithmetic. */
function makeStore() {
  const rows = new Map(); // id → reservation

  function activeHeld(sku, now) {
    let held = 0;
    for (const r of rows.values()) {
      if (r.sku !== String(sku)) continue;
      const active =
        r.state === RESERVATION_STATES.COMMITTED ||
        r.state === RESERVATION_STATES.CONSUMED ||
        (r.state === RESERVATION_STATES.RESERVED && r.expiresAt > now);
      if (active) held += r.quantity;
    }
    return held;
  }

  return {
    _rows: rows,
    async reserveAtomic({ id, sku, quantity, kind, ttlMs, totalStock, now, orderId }) {
      const held = activeHeld(sku, now);
      if (held + quantity > totalStock) return { ok: false, error: "oversell" };
      rows.set(id, {
        id, sku: String(sku), quantity, kind,
        state: RESERVATION_STATES.RESERVED,
        createdAt: now, ttlMs, expiresAt: now + ttlMs, orderId: orderId ?? null,
      });
      return { ok: true, remaining: totalStock - (held + quantity) };
    },
    async getReservation(id) { return rows.has(id) ? { ...rows.get(id) } : null; },
    async saveReservation(reservation) { rows.set(reservation.id, { ...reservation }); },
    async heldQuantity(sku, now) { return activeHeld(sku, now); },
  };
}

const T0 = 1_000_000;

describe("reserve", () => {
  it("holds stock and reports the remaining count", async () => {
    const store = makeStore();
    const res = await reserve({ store, id: "r1", sku: "sku_a", quantity: 2, totalStock: 5, now: T0 });
    expect(res.ok).toBe(true);
    expect(res.remaining).toBe(3);
    expect(res.reservation.state).toBe(RESERVATION_STATES.RESERVED);
    expect(res.reservation.expiresAt).toBe(T0 + DEFAULT_ONLINE_TTL_MS);
  });

  it("uses the longer cash TTL for cash orders", async () => {
    const store = makeStore();
    const res = await reserve({ store, id: "r1", sku: "sku_a", quantity: 1, totalStock: 5, now: T0, kind: RESERVATION_KIND.CASH });
    expect(res.reservation.expiresAt).toBe(T0 + DEFAULT_CASH_TTL_MS);
  });

  it("honors an explicit TTL override", async () => {
    const store = makeStore();
    const res = await reserve({ store, id: "r1", sku: "sku_a", quantity: 1, totalStock: 5, now: T0, ttlMs: 60_000 });
    expect(res.reservation.expiresAt).toBe(T0 + 60_000);
  });

  it("prevents oversell: the last unit cannot be double-held", async () => {
    const store = makeStore();
    const first = await reserve({ store, id: "r1", sku: "sku_a", quantity: 1, totalStock: 1, now: T0 });
    expect(first.ok).toBe(true);
    const second = await reserve({ store, id: "r2", sku: "sku_a", quantity: 1, totalStock: 1, now: T0 });
    expect(second.ok).toBe(false);
    expect(second.error).toBe("oversell");
  });

  it("an expired hold frees stock for a new reservation", async () => {
    const store = makeStore();
    await reserve({ store, id: "r1", sku: "sku_a", quantity: 1, totalStock: 1, now: T0 });
    // After the online TTL elapses, r1 is no longer an active hold.
    const later = T0 + DEFAULT_ONLINE_TTL_MS + 1;
    const res = await reserve({ store, id: "r2", sku: "sku_a", quantity: 1, totalStock: 1, now: later });
    expect(res.ok).toBe(true);
  });

  it("a committed hold keeps blocking stock even past the original TTL", async () => {
    const store = makeStore();
    await reserve({ store, id: "r1", sku: "sku_a", quantity: 1, totalStock: 1, now: T0 });
    await commit({ store, id: "r1", now: T0 });
    const later = T0 + DEFAULT_ONLINE_TTL_MS + 1;
    const res = await reserve({ store, id: "r2", sku: "sku_a", quantity: 1, totalStock: 1, now: later });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("oversell");
  });
});

describe("lifecycle transitions", () => {
  it("commit removes the expiry and consume marks it sold", async () => {
    const store = makeStore();
    await reserve({ store, id: "r1", sku: "sku_a", quantity: 1, totalStock: 3, now: T0 });

    const committed = await commit({ store, id: "r1", now: T0 });
    expect(committed.ok).toBe(true);
    expect(committed.reservation.state).toBe(RESERVATION_STATES.COMMITTED);
    expect(committed.reservation.expiresAt).toBeNull();

    const consumed = await consume({ store, id: "r1" });
    expect(consumed.ok).toBe(true);
    expect(consumed.reservation.state).toBe(RESERVATION_STATES.CONSUMED);
  });

  it("release returns stock to available", async () => {
    const store = makeStore();
    await reserve({ store, id: "r1", sku: "sku_a", quantity: 2, totalStock: 2, now: T0 });
    expect(await availability({ store, sku: "sku_a", totalStock: 2, now: T0 })).toBe(0);

    const released = await release({ store, id: "r1", now: T0 });
    expect(released.ok).toBe(true);
    expect(released.reservation.state).toBe(RESERVATION_STATES.RELEASED);
    expect(await availability({ store, sku: "sku_a", totalStock: 2, now: T0 })).toBe(2);
  });

  it("extend prolongs a live hold's TTL", async () => {
    const store = makeStore();
    await reserve({ store, id: "r1", sku: "sku_a", quantity: 1, totalStock: 3, now: T0 });
    const res = await extend({ store, id: "r1", extraMs: 30_000, now: T0 });
    expect(res.ok).toBe(true);
    expect(res.reservation.expiresAt).toBe(T0 + DEFAULT_ONLINE_TTL_MS + 30_000);
  });

  it("cannot commit an already-expired hold", async () => {
    const store = makeStore();
    await reserve({ store, id: "r1", sku: "sku_a", quantity: 1, totalStock: 3, now: T0 });
    const res = await commit({ store, id: "r1", now: T0 + DEFAULT_ONLINE_TTL_MS + 1 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/expired/);
  });

  it("transitions on a missing reservation report not found", async () => {
    const store = makeStore();
    for (const fn of [commit, consume, release]) {
      const res = await fn({ store, id: "nope", now: T0 });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not found/);
    }
  });
});

describe("availability + currentState reads", () => {
  it("availability subtracts active holds from on-hand stock", async () => {
    const store = makeStore();
    await reserve({ store, id: "r1", sku: "sku_a", quantity: 3, totalStock: 10, now: T0 });
    expect(await availability({ store, sku: "sku_a", totalStock: 10, now: T0 })).toBe(7);
  });

  it("currentState lazily reports an expired hold as EXPIRED", async () => {
    const store = makeStore();
    await reserve({ store, id: "r1", sku: "sku_a", quantity: 1, totalStock: 3, now: T0 });
    expect(await currentState({ store, id: "r1", now: T0 })).toBe(RESERVATION_STATES.RESERVED);
    expect(await currentState({ store, id: "r1", now: T0 + DEFAULT_ONLINE_TTL_MS + 1 })).toBe(RESERVATION_STATES.EXPIRED);
  });
});
