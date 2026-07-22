/**
 * canonicalReservations.js — bridge between the Stripe checkout edge and the
 * inventory-reservation core (src/services/reservationService.js + the
 * reserve_stock advisory-lock RPC). Companion to canonicalSettlement.js.
 *
 * Used only by the feature-flagged checkout wiring in stripe.js (gated by
 * CANONICAL_SETTLEMENT_ENABLED); the legacy checkout path is untouched.
 *
 * Lifecycle across the Stripe flow (MARKETPLACE_STATE_MODEL.md §7):
 *   checkout begins  → reserveCheckoutStock  (bounded TTL hold, oversell-guarded)
 *   payment protected → commitCheckoutReservations (no further TTL)
 *   abandon/expire/fail → releaseCheckoutReservations (stock returns to available)
 *
 * A reservation id is deterministic — `${reservationGroupId}:${sku}` — so the
 * webhook (which only has the PaymentIntent/session metadata, not the ids) can
 * reconstruct the exact holds created at checkout. The reservationGroupId is
 * generated at checkout and stamped into the PI/session metadata.
 */

import { createSupabaseReservationStore } from "./supabaseReservationStore.js";
import {
  reserve as reserveOne,
  commit as commitOne,
  release as releaseOne,
  RESERVATION_KIND,
  DEFAULT_ONLINE_TTL_MS,
} from "../../src/services/reservationService.js";

/** Deterministic reservation id for a (checkout, sku) pair. */
const reservationId = (groupId, sku) => `${groupId}:${sku}`;

/**
 * Derive the set of held units (sku + quantity) from a PaymentIntent/session's
 * metadata, mirroring how stripe.js stamps checkout metadata:
 *   specimen | shipping | pickup → one specimen token (qty 1)
 *   multi                        → one hold per token in tokenIds (qty 1 each)
 *   batch                        → one hold on the listing for `quantity` units
 *
 * @param {Object} metadata - PaymentIntent or Checkout Session metadata
 * @returns {Array<{ sku:string, quantity:number }>}
 */
export function reservationTargetsFromMetadata(metadata) {
  const md = metadata || {};
  const pt = md.purchaseType;
  if (pt === "batch") {
    if (md.listingId == null) return [];
    return [{ sku: String(md.listingId), quantity: Number(md.quantity) || 1 }];
  }
  if (pt === "multi") {
    try {
      const ids = JSON.parse(md.tokenIds || "[]");
      return ids.map((t) => ({ sku: String(t), quantity: 1 }));
    } catch {
      return [];
    }
  }
  // specimen | shipping | pickup
  if (md.tokenId == null) return [];
  return [{ sku: String(md.tokenId), quantity: 1 }];
}

/**
 * Reserve every target unit for a starting checkout under one reservation group.
 * Atomic per-sku via the reserve_stock RPC. If any target is unavailable
 * (oversell) or errors, the holds already taken in this call are rolled back so
 * a partially-reserved checkout never strands stock.
 *
 * @param {Object} args
 * @param {import('@supabase/supabase-js').SupabaseClient} args.supabase - service-role client
 * @param {string} args.reservationGroupId
 * @param {Array<{ sku:string, quantity:number, totalStock:number }>} args.targets
 * @param {number} args.now - epoch ms
 * @param {string} [args.kind] - RESERVATION_KIND (online for Stripe checkouts)
 * @param {number} [args.ttlMs]
 * @returns {Promise<{ ok:boolean, reservationGroupId?:string, reservedIds?:string[], error?:string, unavailableSku?:string }>}
 */
export async function reserveCheckoutStock({
  supabase,
  reservationGroupId,
  targets,
  now,
  kind = RESERVATION_KIND.ONLINE,
  ttlMs = DEFAULT_ONLINE_TTL_MS,
}) {
  const store = createSupabaseReservationStore(supabase);
  const reserved = [];

  for (const t of targets) {
    const id = reservationId(reservationGroupId, t.sku);
    let result;
    try {
      result = await reserveOne({
        store,
        id,
        sku: t.sku,
        quantity: t.quantity,
        totalStock: t.totalStock,
        now,
        kind,
        ttlMs,
      });
    } catch (err) {
      result = { ok: false, error: err?.message || "reserve failed" };
    }

    if (!result.ok) {
      // Roll back the holds already taken in this checkout attempt.
      for (const rid of reserved) {
        try {
          await releaseOne({ store, id: rid, now });
        } catch {
          /* best-effort rollback; TTL expiry is the backstop */
        }
      }
      return { ok: false, error: result.error, unavailableSku: t.sku };
    }
    reserved.push(id);
  }

  return { ok: true, reservationGroupId, reservedIds: reserved };
}

/**
 * Commit the holds for a checkout now that payment is protected. Best-effort and
 * idempotent-ish: a missing hold (flag toggled mid-flight, or TTL already
 * lapsed) is reported per-sku rather than thrown.
 *
 * @returns {Promise<{ ok:boolean, results:Array<{ sku:string, ok:boolean, error?:string }> }>}
 */
export async function commitCheckoutReservations({ supabase, metadata, now }) {
  const groupId = metadata?.reservationGroupId;
  if (!groupId) return { ok: false, results: [], error: "no reservationGroupId" };
  const store = createSupabaseReservationStore(supabase);
  const targets = reservationTargetsFromMetadata(metadata);
  const results = [];
  for (const t of targets) {
    const id = reservationId(groupId, t.sku);
    try {
      const r = await commitOne({ store, id, now });
      results.push({ sku: t.sku, ok: r.ok, error: r.error });
    } catch (e) {
      results.push({ sku: t.sku, ok: false, error: e.message });
    }
  }
  return { ok: results.length > 0 && results.every((r) => r.ok), results };
}

/**
 * Release the holds for an abandoned/failed/expired checkout so stock returns to
 * available sooner than the TTL would. Best-effort per-sku.
 *
 * @returns {Promise<{ ok:boolean, results:Array<{ sku:string, ok:boolean, error?:string }> }>}
 */
export async function releaseCheckoutReservations({ supabase, metadata, now }) {
  const groupId = metadata?.reservationGroupId;
  if (!groupId) return { ok: false, results: [], error: "no reservationGroupId" };
  const store = createSupabaseReservationStore(supabase);
  const targets = reservationTargetsFromMetadata(metadata);
  const results = [];
  for (const t of targets) {
    const id = reservationId(groupId, t.sku);
    try {
      const r = await releaseOne({ store, id, now });
      results.push({ sku: t.sku, ok: r.ok, error: r.error });
    } catch (e) {
      results.push({ sku: t.sku, ok: false, error: e.message });
    }
  }
  return { ok: results.length > 0 && results.every((r) => r.ok), results };
}
