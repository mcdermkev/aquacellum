/**
 * reservationManager.js
 *
 * Inventory reservation lifecycle (Task 13). A reservation is a time-boxed hold
 * on stock — never an indefinite lock — so abandoned checkouts release stock
 * and oversell is prevented (MARKETPLACE_STATE_MODEL.md §7).
 *
 *   available → reserved (checkout begins, bounded TTL)
 *   reserved  → committed (payment protected / cash handoff scheduled — no TTL)
 *   committed → consumed  (certificate transferred / order completed)
 *   reserved  → released/expired (abandonment, TTL expiry, payment failure)
 *   committed → released  (refund with no transfer)
 *
 * Pure and dependency-free. The wall clock is injected (`now`) so expiry is
 * deterministic in tests. IMPORTANT: this layer computes availability and
 * validates transitions; the ATOMIC guarantee against concurrent checkouts of
 * the same unit lives in the database (a transactional check against these
 * rules), not here. Callers must perform the reserve inside a DB transaction.
 */

// ─── TTL policy ──────────────────────────────────────────────────────────────

// Short hold for interactive online checkout; longer, seller-configurable hold
// for cash/event orders that require a scheduled in-person meet (§7).
export const DEFAULT_ONLINE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_CASH_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

export const RESERVATION_KIND = Object.freeze({ ONLINE: "online", CASH: "cash" });

// ─── States ──────────────────────────────────────────────────────────────────

export const RESERVATION_STATES = Object.freeze({
  RESERVED: "reserved",
  COMMITTED: "committed",
  CONSUMED: "consumed",
  RELEASED: "released",
  EXPIRED: "expired",
});

const R = RESERVATION_STATES;

// States that hold stock away from other buyers.
const UNAVAILABLE_STATES = [R.RESERVED, R.COMMITTED, R.CONSUMED];

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Create a new reservation in the RESERVED state with a bounded TTL.
 *
 * @param {Object} args
 * @param {string} args.id
 * @param {string} args.sku - specimen token id or batch listing id (stringified)
 * @param {number} args.quantity
 * @param {number} args.now - current epoch ms (injected)
 * @param {string} [args.kind] - RESERVATION_KIND (picks the default TTL)
 * @param {number} [args.ttlMs] - explicit TTL override (seller-configurable for cash)
 * @returns {Object} reservation record
 */
export function createReservation({ id, sku, quantity, now, kind = RESERVATION_KIND.ONLINE, ttlMs }) {
  const qty = Math.max(1, Math.round(Number(quantity) || 0));
  const effectiveTtl = Number.isFinite(ttlMs) && ttlMs > 0
    ? ttlMs
    : (kind === RESERVATION_KIND.CASH ? DEFAULT_CASH_TTL_MS : DEFAULT_ONLINE_TTL_MS);
  return {
    id,
    sku: String(sku),
    quantity: qty,
    kind,
    state: R.RESERVED,
    createdAt: now,
    ttlMs: effectiveTtl,
    expiresAt: now + effectiveTtl,
  };
}

// ─── State inspection ────────────────────────────────────────────────────────

/**
 * The effective state at time `now`: a RESERVED hold whose TTL has elapsed
 * reports as EXPIRED (lazy expiry — no background job needed to free stock for
 * availability math). COMMITTED holds never expire.
 * @returns {string}
 */
export function effectiveState(reservation, now) {
  if (reservation.state === R.RESERVED && now >= reservation.expiresAt) return R.EXPIRED;
  return reservation.state;
}

export function isActiveHold(reservation, now) {
  return UNAVAILABLE_STATES.includes(effectiveState(reservation, now));
}

/**
 * Units of a SKU still available given total on-hand stock and the current set
 * of reservations. Active holds (reserved-not-expired, committed, consumed)
 * subtract from availability; expired/released ones do not.
 *
 * @param {number} totalStock
 * @param {Object[]} reservations
 * @param {string} sku
 * @param {number} now
 * @returns {number}
 */
export function availableQuantity(totalStock, reservations, sku, now) {
  const key = String(sku);
  const held = reservations
    .filter((r) => r.sku === key && isActiveHold(r, now))
    .reduce((sum, r) => sum + r.quantity, 0);
  return Math.max(0, Number(totalStock) - held);
}

/**
 * Whether `qty` units of `sku` can be reserved right now.
 */
export function canReserve(totalStock, reservations, sku, qty, now) {
  return availableQuantity(totalStock, reservations, sku, now) >= Math.max(1, Math.round(qty));
}

// ─── Transitions (return a result; never mutate the input) ───────────────────

function tx(ok, reservation, error) {
  return error ? { ok: false, error } : { ok: true, reservation };
}

/**
 * Extend a RESERVED hold's TTL (e.g. the buyer is actively progressing). No-op
 * illegal on committed/expired/terminal holds.
 */
export function extend(reservation, extraMs, now) {
  if (effectiveState(reservation, now) !== R.RESERVED) {
    return tx(false, null, `cannot extend a ${effectiveState(reservation, now)} reservation`);
  }
  const base = Math.max(now, reservation.expiresAt);
  return tx(true, { ...reservation, expiresAt: base + Math.max(0, Number(extraMs) || 0) });
}

/**
 * Commit a RESERVED hold (payment protected / cash handoff scheduled). A
 * committed hold no longer expires.
 */
export function commit(reservation, now) {
  if (effectiveState(reservation, now) !== R.RESERVED) {
    return tx(false, null, `cannot commit a ${effectiveState(reservation, now)} reservation`);
  }
  return tx(true, { ...reservation, state: R.COMMITTED, expiresAt: null });
}

/**
 * Consume a COMMITTED hold (stock permanently sold at completion).
 */
export function consume(reservation) {
  if (reservation.state !== R.COMMITTED) {
    return tx(false, null, `cannot consume a ${reservation.state} reservation`);
  }
  return tx(true, { ...reservation, state: R.CONSUMED });
}

/**
 * Release a RESERVED or COMMITTED hold back to available stock (abandonment,
 * payment failure, or refund with no transfer).
 */
export function release(reservation, now) {
  const eff = effectiveState(reservation, now);
  if (eff !== R.RESERVED && eff !== R.COMMITTED) {
    return tx(false, null, `cannot release a ${eff} reservation`);
  }
  return tx(true, { ...reservation, state: R.RELEASED });
}
