/**
 * reservationService.js
 *
 * The server-side application service that persists the pure reservationManager
 * core (Task 13). It is the single place a request handler calls to hold stock
 * at checkout, promote a hold as payment/handoff progresses, or release it on
 * abandonment — so the reservation lifecycle in MARKETPLACE_STATE_MODEL.md §7
 * has one authoritative implementation instead of ad-hoc inventory writes.
 *
 * Dependency-injected by design:
 *   - `store` — a persistence port (see the "Store port" contract below). The
 *               Supabase implementation is api/_lib/supabaseReservationStore.js;
 *               tests use an in-memory fake.
 *
 * The oversell-prevention guarantee is NOT in this module: creating a hold is
 * delegated to store.reserveAtomic, which the Supabase adapter implements with
 * a per-sku advisory lock + check + insert in one transaction. This service
 * owns the TTL policy selection and the state transitions (which are pure).
 *
 * Store port (all async):
 *   reserveAtomic({ id, sku, quantity, kind, ttlMs, totalStock, now, orderId })
 *        → { ok:true, remaining } | { ok:false, error:'oversell' }
 *   getReservation(id)          → reservation | null
 *   saveReservation(reservation)→ void   (persists a transitioned hold)
 *   heldQuantity(sku, now)      → number  (active held units; availability read)
 */

import {
  createReservation,
  commit as commitReservation,
  consume as consumeReservation,
  release as releaseReservation,
  extend as extendReservation,
  effectiveState,
  RESERVATION_KIND,
  DEFAULT_ONLINE_TTL_MS,
  DEFAULT_CASH_TTL_MS,
} from "./reservationManager.js";

/**
 * Reserve stock for a checkout. Builds the reservation record (which selects
 * the TTL by kind unless an explicit ttlMs override is given) and performs the
 * atomic reserve through the store. On oversell the store rejects and no hold
 * is created.
 *
 * @param {Object} params
 * @param {Object} params.store
 * @param {string} params.id - caller-chosen reservation id
 * @param {string} params.sku - specimen token id or batch listing id
 * @param {number} params.quantity
 * @param {number} params.totalStock - on-hand units the caller derived from inventory
 * @param {number} params.now - epoch ms
 * @param {string} [params.kind] - RESERVATION_KIND (default online)
 * @param {number} [params.ttlMs] - explicit TTL override (seller-configurable for cash)
 * @param {string} [params.orderId]
 * @returns {Promise<{ ok:boolean, reservation?:Object, remaining?:number, error?:string }>}
 */
export async function reserve({ store, id, sku, quantity, totalStock, now, kind = RESERVATION_KIND.ONLINE, ttlMs, orderId = null }) {
  const reservation = createReservation({ id, sku, quantity, now, kind, ttlMs });
  const result = await store.reserveAtomic({
    id: reservation.id,
    sku: reservation.sku,
    quantity: reservation.quantity,
    kind: reservation.kind,
    ttlMs: reservation.ttlMs,
    totalStock,
    now,
    orderId,
  });
  if (!result.ok) return { ok: false, error: result.error || "reserve failed" };
  return { ok: true, reservation: { ...reservation, orderId }, remaining: result.remaining };
}

/** Extend a live hold's TTL (buyer is actively progressing). */
export async function extend({ store, id, extraMs, now }) {
  const reservation = await store.getReservation(id);
  if (!reservation) return { ok: false, error: "reservation not found" };
  const res = extendReservation(reservation, extraMs, now);
  if (!res.ok) return res;
  await store.saveReservation(res.reservation);
  return { ok: true, reservation: res.reservation };
}

/** Commit a hold (payment protected / cash handoff scheduled). No further TTL. */
export async function commit({ store, id, now }) {
  const reservation = await store.getReservation(id);
  if (!reservation) return { ok: false, error: "reservation not found" };
  const res = commitReservation(reservation, now);
  if (!res.ok) return res;
  await store.saveReservation(res.reservation);
  return { ok: true, reservation: res.reservation };
}

/** Consume a committed hold (stock permanently sold at completion). */
export async function consume({ store, id }) {
  const reservation = await store.getReservation(id);
  if (!reservation) return { ok: false, error: "reservation not found" };
  const res = consumeReservation(reservation);
  if (!res.ok) return res;
  await store.saveReservation(res.reservation);
  return { ok: true, reservation: res.reservation };
}

/** Release a hold back to available stock (abandonment / payment failure / refund). */
export async function release({ store, id, now }) {
  const reservation = await store.getReservation(id);
  if (!reservation) return { ok: false, error: "reservation not found" };
  const res = releaseReservation(reservation, now);
  if (!res.ok) return res;
  await store.saveReservation(res.reservation);
  return { ok: true, reservation: res.reservation };
}

/**
 * Units of a sku available right now: on-hand stock minus active holds. A read
 * for cart/PDP display — the authoritative oversell check still happens in
 * reserve() via the atomic store path.
 */
export async function availability({ store, sku, totalStock, now }) {
  const held = await store.heldQuantity(sku, now);
  return Math.max(0, Number(totalStock) - held);
}

/** Convenience: the effective (lazily-expired) state of a stored hold. */
export async function currentState({ store, id, now }) {
  const reservation = await store.getReservation(id);
  if (!reservation) return null;
  return effectiveState(reservation, now);
}

export { RESERVATION_KIND, DEFAULT_ONLINE_TTL_MS, DEFAULT_CASH_TTL_MS };
