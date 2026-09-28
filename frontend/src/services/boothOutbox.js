/**
 * boothOutbox.js — durable offline queue for booth cash sales
 * (BOOTH_BUILD_SPEC.md §4 C2 / §6, decision D6).
 *
 * The problem this exists for: expo wifi is bad, the sale already happened in
 * cash, and every other cloud write in this codebase is fire-and-forget with no
 * retry (`cloudSync.js` logs a warning and drops it). Dropping a booth sale is
 * worse than not shipping the feature, so this one is durable by construction.
 *
 * The contract that makes replay safe:
 *   `saleId` is generated ONCE per sale attempt, client-side, and stored before
 *   the first network call. Every retry reuses it. `record_inventory_sale` is
 *   idempotent on that id, so a queue replayed five times decrements once. Never
 *   mint a fresh saleId on retry — that would turn one cash sale into five.
 *
 * MONEY BOUNDARY: this module moves rows, not money. It records what the seller
 * says they charged. No fee, no total, no rate.
 *
 * Every function takes an injectable `table` (defaulting to the real Dexie
 * store) and `replayQueue` takes an injectable `send`, so the queue → replay →
 * mark-sent lifecycle is testable without a component or a network.
 */

import { db } from "../db";

export const BOOTH_SALE_STATUS = Object.freeze({
  /** Recorded locally, not yet accepted by the server. */
  QUEUED: "queued",
  /** The server accepted it (or told us it already had it). Terminal. */
  SENT: "sent",
  /** The server refused it for a reason retrying cannot fix. Terminal. */
  REJECTED: "rejected",
});

/** Server codes that a retry can never fix — replaying them just burns battery. */
const PERMANENT_CODES = Object.freeze([
  "OUT_OF_STOCK",
  "NOT_YOUR_LISTING",
  "LISTING_NOT_FOUND",
  "SALE_ID_REQUIRED",
  "LISTING_REQUIRED",
  "RAIL_NOT_ALLOWED",
  // The seller removed this helper; replaying won't change that.
  "NOT_BOOTH_STAFF",
  "SALE_ID_RESERVED",
  "SALE_ID_CONFLICT",
  "HELPER_QUANTITY_LIMIT",
  "HELPER_PRICE_REQUIRED",
  // Only returned to a live tap; the seller decides what to do, no auto-retry.
  "HELD_FOR_CHECKOUT",
]);

function defaultTable() {
  return db.boothSaleQueue;
}

/** True when the server's answer is final and the row should stop being retried. */
export function isPermanentFailure(result) {
  if (!result) return false;
  if (result.permanent === true) return true;
  if (result.code && PERMANENT_CODES.includes(result.code)) return true;
  const status = Number(result.status);
  return status === 400 || status === 403 || status === 404 || status === 409;
}

/**
 * Build the row that goes in the queue. Pure — no Dexie, no clock unless the
 * caller omits one, so tests can pin ordering.
 *
 * @param {object} sale
 * @param {string} sale.saleId - client-generated, reused across every retry
 * @param {string|number} sale.listingId
 * @param {number} sale.quantity
 * @param {number} sale.unitPriceCents - what the seller actually charged per fish
 * @param {string} [sale.sellerAddress]
 * @param {string|null} [sale.note]
 * @param {number} [sale.createdAt]
 */
export function buildQueuedSale(sale = {}) {
  if (!sale.saleId) throw new Error("boothOutbox: saleId is required");
  if (sale.listingId == null || String(sale.listingId).trim() === "") {
    throw new Error("boothOutbox: listingId is required");
  }
  return {
    saleId: String(sale.saleId),
    listingId: String(sale.listingId),
    sellerAddress: sale.sellerAddress ? String(sale.sellerAddress).toLowerCase() : null,
    // Set when a helper rings up a sale for someone else's booth, so a replay
    // after reconnect lands on that booth — not the helper's own stock.
    forSeller: sale.forSeller ? String(sale.forSeller).toLowerCase() : null,
    quantity: Math.max(1, Math.round(Number(sale.quantity) || 1)),
    unitPriceCents: Math.max(0, Math.round(Number(sale.unitPriceCents) || 0)),
    note: sale.note ? String(sale.note).slice(0, 500) : null,
    rail: "cash",
    status: BOOTH_SALE_STATUS.QUEUED,
    createdAt: Number(sale.createdAt) || Date.now(),
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    quantityRemaining: null,
    orderId: null,
    rejectedReason: null,
  };
}

/**
 * Persist a sale locally BEFORE attempting the network. This ordering is the
 * feature: if the tab dies mid-POST the sale is still on disk.
 *
 * `put` rather than `add` so re-queueing the same saleId is a no-op-shaped
 * upsert instead of a throw.
 */
export async function queueSale(sale, { table = defaultTable() } = {}) {
  const row = buildQueuedSale(sale);
  await table.put(row);
  return row;
}

/** Mark a sale accepted, recording the server's authoritative remaining count. */
export async function markSaleSent(saleId, { quantityRemaining = null, orderId = null } = {}, { table = defaultTable() } = {}) {
  const existing = await table.get(String(saleId));
  if (!existing) return null;
  const updated = {
    ...existing,
    status: BOOTH_SALE_STATUS.SENT,
    quantityRemaining: quantityRemaining == null ? existing.quantityRemaining : Number(quantityRemaining),
    orderId: orderId ?? existing.orderId,
    lastError: null,
    lastAttemptAt: Date.now(),
  };
  await table.put(updated);
  return updated;
}

/**
 * Mark a sale permanently refused. Kept rather than deleted so the seller can
 * see that the fish they handed over was rejected as out of stock — silently
 * dropping it would recreate the vanishing-sale problem from the other side.
 */
export async function markSaleRejected(saleId, reason, { table = defaultTable() } = {}) {
  const existing = await table.get(String(saleId));
  if (!existing) return null;
  const updated = {
    ...existing,
    status: BOOTH_SALE_STATUS.REJECTED,
    rejectedReason: reason ? String(reason) : "rejected",
    lastAttemptAt: Date.now(),
  };
  await table.put(updated);
  return updated;
}

/** Record a transient failure without leaving QUEUED — the row stays replayable. */
export async function markSaleDeferred(saleId, error, { table = defaultTable() } = {}) {
  const existing = await table.get(String(saleId));
  if (!existing) return null;
  const updated = {
    ...existing,
    status: BOOTH_SALE_STATUS.QUEUED,
    attempts: (Number(existing.attempts) || 0) + 1,
    lastAttemptAt: Date.now(),
    lastError: error ? String(error).slice(0, 300) : "network",
  };
  await table.put(updated);
  return updated;
}

/** Queued sales, oldest first — replay in the order the fish left the table. */
export async function listQueuedSales({ table = defaultTable(), sellerAddress = null } = {}) {
  const rows = await table.where("status").equals(BOOTH_SALE_STATUS.QUEUED).toArray();
  const scoped = sellerAddress
    ? rows.filter((r) => !r.sellerAddress || r.sellerAddress === String(sellerAddress).toLowerCase())
    : rows;
  return scoped.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/** Count for the badge in the UI. */
export async function countQueuedSales({ table = defaultTable(), sellerAddress = null } = {}) {
  const rows = await listQueuedSales({ table, sellerAddress });
  return rows.length;
}

/** Rejected sales, so the UI can surface a refusal instead of hiding it. */
export async function listRejectedSales({ table = defaultTable() } = {}) {
  const rows = await table.where("status").equals(BOOTH_SALE_STATUS.REJECTED).toArray();
  return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// A single in-flight replay per tab. Two replays racing (mount + an "online"
// event firing together) would double-POST every row; harmless thanks to server
// idempotency, but it wastes a bad connection when it is most scarce.
let _replayInFlight = null;

/**
 * Drain the queue. `send` receives the stored row and MUST reuse `row.saleId` —
 * that is what makes this safe to call as often as we like.
 *
 * @param {object} options
 * @param {(row:object)=>Promise<object>} options.send
 * @returns {Promise<{attempted:number, sent:number, rejected:number, deferred:number}>}
 */
export async function replayQueue({ send, table = defaultTable(), sellerAddress = null } = {}) {
  if (typeof send !== "function") throw new Error("boothOutbox: send is required");
  if (_replayInFlight) return _replayInFlight;

  _replayInFlight = (async () => {
    const summary = { attempted: 0, sent: 0, rejected: 0, deferred: 0 };
    const pending = await listQueuedSales({ table, sellerAddress });

    for (const row of pending) {
      summary.attempted += 1;
      let result;
      try {
        // The stored row is passed whole so `send` cannot help but reuse saleId.
        result = await send(row);
      } catch (err) {
        await markSaleDeferred(row.saleId, err?.message || "send threw", { table });
        summary.deferred += 1;
        continue;
      }

      if (result?.ok || result?.success) {
        await markSaleSent(
          row.saleId,
          { quantityRemaining: result.quantityRemaining, orderId: result.orderId },
          { table }
        );
        summary.sent += 1;
      } else if (isPermanentFailure(result)) {
        await markSaleRejected(row.saleId, result.code || result.error, { table });
        summary.rejected += 1;
      } else {
        await markSaleDeferred(row.saleId, result?.error, { table });
        summary.deferred += 1;
      }
    }

    return summary;
  })();

  try {
    return await _replayInFlight;
  } finally {
    _replayInFlight = null;
  }
}

/**
 * Drop terminal rows past a retention window so a season of expos doesn't grow
 * the store without bound. Only SENT rows are pruned — a REJECTED sale is
 * something the seller still needs to see.
 */
export async function pruneSentSales({ table = defaultTable(), olderThanMs = 7 * 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
  const cutoff = now - olderThanMs;
  const rows = await table.where("status").equals(BOOTH_SALE_STATUS.SENT).toArray();
  const stale = rows.filter((r) => (r.createdAt || 0) < cutoff).map((r) => r.saleId);
  if (stale.length) await table.bulkDelete(stale);
  return stale.length;
}

/**
 * Generate the id a sale is recorded under. Extracted so the component has a
 * single obvious place to call it exactly once, and so a browser without
 * `crypto.randomUUID` still gets a unique-enough id rather than throwing at the
 * moment of sale.
 */
export function newSaleId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `booth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
