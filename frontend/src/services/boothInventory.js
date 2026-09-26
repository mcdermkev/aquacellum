/**
 * boothInventory.js — pure view logic for the booth inventory surface
 * (BOOTH_BUILD_SPEC.md §6, workstream E).
 *
 * MONEY BOUNDARY: there is no money math here and there must never be. No fee
 * rate, no platform-fee constant, no total. The only arithmetic is the
 * dollars→cents unit conversion needed to hand `unitPriceCents` to
 * `?action=record-sale`, and it mirrors the server's own normalizer at
 * api/storefront-detail.js (`d.priceCentsUSD ?? round(price * 100)`) so the two
 * sides read a row identically. The server computes the sale total; the booth
 * only reports what was charged per fish.
 *
 * Everything in this file is a pure function over plain data so the counter
 * behaviour (optimistic decrement, server reconciliation, sold-out gating,
 * search) is testable without mounting the component or touching Dexie.
 */

/**
 * `quantity_remaining` is a real column as of 20260916_inventory_of_record.sql,
 * but rows written before it can still be NULL. NULL means "we do not know",
 * which is NOT the same as zero — showing 0 would falsely mark a stocked line
 * sold out and make it unsellable at the table.
 */
export const UNKNOWN_REMAINING = "—";

/** Listing key shape used by the product route and the cart/checkout seam. */
export function boothListingKey(row) {
  if (!row) return "";
  const isBatch = !!(row.is_batch ?? row.isBatch);
  const id = row.id ?? row.listingId ?? "";
  return `${isBatch ? "batch" : "single"}-${id}`;
}

/**
 * Normalize one `aquadex_listings` row into the flat shape the booth renders.
 * Species/photo details live in the `data` JSON blob, which is why this exists
 * rather than reading the row directly in JSX.
 *
 * @param {object} row - a raw Supabase row
 * @returns {object|null}
 */
export function normalizeBoothLine(row) {
  if (!row || row.id == null) return null;
  const data = row.data && typeof row.data === "object" ? row.data : {};

  // Unit conversion only — same expression the server uses to read a row.
  const priceCents =
    Number(data.priceCentsUSD ?? Math.round(Number(row.price || 0) * 100)) || 0;

  const rawRemaining = row.quantity_remaining ?? row.quantityRemaining;
  const rawTotal = row.quantity_total ?? row.quantityTotal;

  return {
    id: String(row.id),
    listingKey: boothListingKey(row),
    commonName: row.common_name || data.commonName || "Unnamed line",
    scientificName: data.scientificName || null,
    photoUrl: data.photoUrl || null,
    priceCents,
    isBatch: !!row.is_batch,
    isActive: row.is_active !== false,
    // null is preserved deliberately — see UNKNOWN_REMAINING.
    quantityRemaining: rawRemaining == null ? null : Number(rawRemaining),
    quantityTotal: rawTotal == null ? null : Number(rawTotal),
  };
}

/** Normalize a page of rows, dropping anything unusable. */
export function normalizeBoothLines(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeBoothLine)
    .filter(Boolean);
}

/** The product path a Card sale is handed off to (existing guest checkout). */
export function boothProductPath(line) {
  return `/app/products/${encodeURIComponent(line?.listingKey || "")}`;
}

/**
 * A line is sold out only when we KNOW the remaining count is zero. An unknown
 * (null) count stays sellable — the seller is standing in front of the fish and
 * is a better authority than a column that predates the migration.
 */
export function isSoldOut(line) {
  return line?.quantityRemaining === 0;
}

/** Sold-out lines and deactivated lines cannot be sold at the booth. */
export function isSellable(line) {
  return !!line && !isSoldOut(line);
}

/** Display string for the big remaining count. */
export function formatRemaining(line) {
  const remaining = line?.quantityRemaining;
  return remaining == null ? UNKNOWN_REMAINING : String(remaining);
}

/**
 * Clamp a stepper value. Lower bound is always 1 (a zero-quantity sale is not a
 * sale). Upper bound is the known remaining count; with an unknown count there
 * is nothing to clamp against, so only the floor applies.
 */
export function clampSellQuantity(quantity, remaining) {
  const n = Math.floor(Number(quantity));
  const safe = Number.isFinite(n) ? n : 1;
  const floored = Math.max(1, safe);
  if (remaining == null) return floored;
  const ceiling = Math.max(0, Math.floor(Number(remaining) || 0));
  if (ceiling <= 0) return 0;
  return Math.min(floored, ceiling);
}

/** Case-insensitive search over common + scientific name. */
export function filterBoothLines(lines, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return Array.isArray(lines) ? lines : [];
  return (Array.isArray(lines) ? lines : []).filter((line) => {
    const haystack = `${line.commonName || ""} ${line.scientificName || ""}`.toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * Optimistic decrement. Applied the moment the seller taps Cash so the count on
 * screen matches the bag that just left the table, before any network round trip.
 * An unknown count stays unknown rather than being invented.
 */
export function applyLocalSale(lines, listingId, quantity) {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  return (Array.isArray(lines) ? lines : []).map((line) => {
    if (line.id !== String(listingId)) return line;
    if (line.quantityRemaining == null) return line;
    return { ...line, quantityRemaining: Math.max(0, line.quantityRemaining - qty) };
  });
}

/**
 * Reconcile against the server's returned `quantityRemaining`, which is
 * authoritative (the RPC holds an advisory lock and is idempotent on saleId).
 * The optimistic guess above is only ever a guess — another device at the same
 * booth may have sold the same fish.
 */
export function reconcileRemaining(lines, listingId, quantityRemaining) {
  if (quantityRemaining == null || !Number.isFinite(Number(quantityRemaining))) {
    return Array.isArray(lines) ? lines : [];
  }
  const authoritative = Math.max(0, Math.floor(Number(quantityRemaining)));
  return (Array.isArray(lines) ? lines : []).map((line) =>
    line.id === String(listingId)
      ? { ...line, quantityRemaining: authoritative, isActive: authoritative > 0 && line.isActive }
      : line
  );
}

/**
 * Apply the server's result of a +/- stock adjust. Mirrors adjust_inventory_by:
 * reaching 0 retires the line, a positive delta puts it back on sale, and a
 * negative delta never re-activates a paused line. The count is the server's.
 */
export function applyAdjustResult(lines, listingId, quantityRemaining, delta) {
  if (quantityRemaining == null || !Number.isFinite(Number(quantityRemaining))) {
    return Array.isArray(lines) ? lines : [];
  }
  const n = Math.max(0, Math.floor(Number(quantityRemaining)));
  return (Array.isArray(lines) ? lines : []).map((line) => {
    if (line.id !== String(listingId)) return line;
    const isActive = n === 0 ? false : Number(delta) > 0 ? true : line.isActive;
    return { ...line, quantityRemaining: n, isActive };
  });
}

/**
 * Wording only. `casualModeActive` never changes what a control does — it is the
 * same prop the rest of breeder/ uses to soften vocabulary for hobbyists.
 */
export function boothCopy(casualModeActive = false) {
  return casualModeActive
    ? {
        sectionTitle: "Booth",
        subtitle: "What's in the tank, and what just sold.",
        remainingLabel: "left",
        searchPlaceholder: "Find a fish…",
        sellLabel: "Sell",
        soldOut: "All gone",
        emptyState: "Nothing listed yet, so there's nothing to sell here.",
        noMatches: "No fish match that.",
        quantityLabel: "How many fish?",
        cashHelp: "Records the sale. Free, always.",
        cardOfflineReason: "Card needs a connection",
        queuedLabel: "waiting to sync",
        offlineLabel: "No connection — cash sales still work",
        adjustUpLabel: "One more",
        adjustDownLabel: "One less",
        adjustOfflineReason: "Fixing counts needs a connection",
      }
    : {
        sectionTitle: "Booth",
        subtitle: "Live stock and in-person sales.",
        remainingLabel: "left",
        searchPlaceholder: "Search inventory…",
        sellLabel: "Sell",
        soldOut: "Sold out",
        emptyState: "No listings.",
        noMatches: "No matches.",
        quantityLabel: "Quantity",
        cashHelp: "Records the sale. No fee.",
        cardOfflineReason: "Card needs a connection",
        queuedLabel: "queued",
        offlineLabel: "Offline — cash sales still record",
        adjustUpLabel: "Add one",
        adjustDownLabel: "Remove one",
        adjustOfflineReason: "Stock adjustments need a connection",
      };
}
