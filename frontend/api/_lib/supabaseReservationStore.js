/**
 * supabaseReservationStore.js — persistence adapter (I/O boundary) implementing
 * the store port consumed by src/services/reservationService.js against the
 * canonical_reservations table (migration 20260721_doa_reservations.sql).
 *
 * Thin by design: map rows to the camelCase shape the reservationManager core
 * expects and back, and delegate the ATOMIC reserve (oversell prevention) to
 * the reserve_stock() Postgres function, which serializes per-sku with an
 * advisory lock. All availability/transition decisions live in the pure core;
 * this file only reads and writes.
 *
 * Usage in a handler:
 *   const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
 *   const store = createSupabaseReservationStore(supabase);
 *   const res = await reserve({ store, id, sku, quantity, totalStock, now, ... });
 */

const RESERVATIONS = "canonical_reservations";

/** Map a canonical_reservations row to the reservation shape the core expects. */
function rowToReservation(row) {
  if (!row) return null;
  return {
    id: row.id,
    sku: row.sku,
    quantity: row.quantity,
    kind: row.kind,
    state: row.state,
    createdAt: Number(row.created_at_ms),
    ttlMs: Number(row.ttl_ms),
    expiresAt: row.expires_at_ms == null ? null : Number(row.expires_at_ms),
    orderId: row.order_id ?? null,
  };
}

/** Map a reservation (from the core) to the persisted column patch. */
function reservationToPatch(r) {
  return {
    state: r.state,
    ttl_ms: r.ttlMs,
    expires_at_ms: r.expiresAt == null ? null : r.expiresAt,
    order_id: r.orderId ?? null,
  };
}

/**
 * Build a store implementing the reservationService port over Supabase.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - service-role client
 */
export function createSupabaseReservationStore(supabase) {
  return {
    /**
     * Atomically reserve stock. Delegates to the reserve_stock() RPC so the
     * held-vs-available check and the insert happen under one per-sku lock.
     * Returns { ok:true, remaining } or { ok:false, error } on oversell.
     */
    async reserveAtomic({ id, sku, quantity, kind, ttlMs, totalStock, now, orderId = null }) {
      const { data, error } = await supabase.rpc("reserve_stock", {
        p_id: id,
        p_sku: String(sku),
        p_quantity: quantity,
        p_kind: kind,
        p_ttl_ms: ttlMs,
        p_total_stock: totalStock,
        p_now_ms: now,
        p_order_id: orderId,
      });
      if (error) {
        // The function raises check_violation with an 'oversell:' message when
        // the request cannot be satisfied; surface it as a clean failure.
        if (/oversell/i.test(error.message)) return { ok: false, error: "oversell" };
        throw new Error(`reserveAtomic failed: ${error.message}`);
      }
      return { ok: true, remaining: Number(data) };
    },

    async getReservation(id) {
      const { data, error } = await supabase.from(RESERVATIONS).select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(`getReservation failed: ${error.message}`);
      return rowToReservation(data);
    },

    /** Active held units for a sku (non-atomic read for availability display). */
    async heldQuantity(sku, now) {
      const { data, error } = await supabase
        .from(RESERVATIONS)
        .select("quantity, state, expires_at_ms")
        .eq("sku", String(sku));
      if (error) throw new Error(`heldQuantity failed: ${error.message}`);
      return (data || [])
        .filter((r) =>
          r.state === "committed" ||
          r.state === "consumed" ||
          (r.state === "reserved" && Number(r.expires_at_ms) > now))
        .reduce((sum, r) => sum + r.quantity, 0);
    },

    /** Persist a transitioned reservation (commit/consume/release/extend). */
    async saveReservation(reservation) {
      const { error } = await supabase
        .from(RESERVATIONS)
        .update(reservationToPatch(reservation))
        .eq("id", reservation.id);
      if (error) throw new Error(`saveReservation failed: ${error.message}`);
    },
  };
}
