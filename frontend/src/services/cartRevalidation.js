/**
 * cartRevalidation.js
 *
 * Pure cart-vs-live-catalog reconciliation (Task 10, §4). **This is the
 * Opus-review-gated module** per docs/TASK_10_CART_SPEC.md — a wrong
 * "still available" verdict here is oversell-adjacent, and a wrong stale
 * price would carry into checkout. Read the spec's §4 before changing this
 * file's decision rules.
 *
 * `revalidateCart(cart, liveListings, opts)` reconciles every cart item
 * against the current `useMarketplaceListings` set and returns a NEW cart
 * (corrections applied) plus a `changes[]` list describing what moved, so
 * the UI can surface calm, specific feedback ("price updated", "only 2
 * left", "no longer available") instead of silently mutating or dropping
 * anything.
 *
 * Hard rules this module must uphold (see spec §4):
 *   - Never silently drop a cart item. An unavailable item stays IN the
 *     cart, marked `unavailable: true`, excluded from totals/checkout, with
 *     a remove affordance — the buyer decides to remove it, not this code.
 *   - Never carry a stale price into checkout. If the live price differs
 *     from the carted price, the carted price is corrected immediately.
 *   - Never call the network, create a reservation, or navigate. This is a
 *     pure reconciliation pass only; checkout's own reservation flow (Task
 *     13, already wired) remains the actual oversell backstop.
 *   - Never throw on malformed/missing input — treat anything that can't be
 *     resolved as unavailable rather than crash the cart.
 *
 * Pure and dependency-free (besides catalogQuery.js's identity/price/active
 * primitives, which this module reuses rather than re-deriving).
 */

import { getListingKey, normalizePriceCents, isListingActive } from "./catalogQuery.js";

export const CART_CHANGE_TYPE = Object.freeze({
  UNAVAILABLE: "unavailable",
  QUANTITY_REDUCED: "quantity_reduced",
  PRICE_CHANGED: "price_changed",
});

/** Build a lookup of live listings by their listingKey. Defensive against a
 * malformed liveListings argument (missing/non-array) — treated as "no live
 * listings", so every cart item resolves to unavailable rather than throwing.
 */
function indexLiveListings(liveListings) {
  const byKey = new Map();
  if (!Array.isArray(liveListings)) return byKey;
  for (const listing of liveListings) {
    if (!listing) continue;
    try {
      const key = getListingKey(listing);
      if (key) byKey.set(key, listing);
    } catch {
      // A malformed listing shouldn't abort indexing the rest — skip it.
    }
  }
  return byKey;
}

/**
 * Revalidate one cart item against its live listing (or its absence).
 * Returns the corrected item and any change record produced.
 *
 * @param {Object} item - a CartItem (see cartModel.js)
 * @param {Object|undefined} live - the matching live listing, or undefined
 * @returns {{ item: Object, change: Object|null }}
 */
function revalidateItem(item, live) {
  // No matching live listing at all (delisted, sold, id no longer resolves).
  if (!live) {
    if (item.unavailable) return { item, change: null }; // already flagged, no new change
    return {
      item: { ...item, unavailable: true },
      change: { type: CART_CHANGE_TYPE.UNAVAILABLE, listingKey: item.listingKey },
    };
  }

  // Defensively treat a live listing missing the fields we need as
  // unavailable rather than guessing — a half-formed record is not a safe
  // basis for "yes, this is still purchasable."
  let active;
  try {
    active = isListingActive(live);
  } catch {
    active = false;
  }
  if (!active) {
    if (item.unavailable) return { item, change: null };
    return {
      item: { ...item, unavailable: true },
      change: { type: CART_CHANGE_TYPE.UNAVAILABLE, listingKey: item.listingKey },
    };
  }

  // A single specimen whose token id is no longer present as a live single
  // listing (e.g. it was re-typed to batch, or the id field is missing) is
  // unavailable — singles are unique units, there's no "reduced quantity"
  // case for them.
  if (!item.isBatch) {
    const liveTokenId = live.tokenId ?? live.id ?? null;
    if (liveTokenId == null || Number(liveTokenId) !== Number(item.tokenId)) {
      return {
        item: { ...item, unavailable: true },
        change: { type: CART_CHANGE_TYPE.UNAVAILABLE, listingKey: item.listingKey },
      };
    }
  }

  let nextItem = item.unavailable ? { ...item, unavailable: false } : item;
  let change = null;

  // Batch quantity reduced below what's carted (including down to zero).
  if (item.isBatch) {
    const liveQty = Number(live.quantity);
    const safeLiveQty = Number.isFinite(liveQty) ? liveQty : 0;
    if (safeLiveQty <= 0) {
      return {
        item: { ...nextItem, unavailable: true },
        change: { type: CART_CHANGE_TYPE.UNAVAILABLE, listingKey: item.listingKey },
      };
    }
    if (safeLiveQty < item.quantity) {
      nextItem = {
        ...nextItem,
        quantity: safeLiveQty,
        snapshot: { ...nextItem.snapshot, quantityAvailable: safeLiveQty },
      };
      change = { type: CART_CHANGE_TYPE.QUANTITY_REDUCED, listingKey: item.listingKey, from: item.quantity, to: safeLiveQty };
    } else if (safeLiveQty !== nextItem.snapshot?.quantityAvailable) {
      // Keep the snapshot's availability figure current even when it isn't
      // binding right now, so a later re-add/setQuantity clamp is accurate.
      nextItem = { ...nextItem, snapshot: { ...nextItem.snapshot, quantityAvailable: safeLiveQty } };
    }
  }

  // Price changed (checked after quantity so a price_changed change record
  // reflects the final corrected item either way — these are independent
  // corrections and both can apply to the same item in one pass).
  let liveCents;
  try {
    liveCents = normalizePriceCents(live);
  } catch {
    liveCents = null;
  }
  if (Number.isFinite(liveCents) && liveCents !== nextItem.unitPriceCents) {
    const priceChange = { type: CART_CHANGE_TYPE.PRICE_CHANGED, listingKey: item.listingKey, from: nextItem.unitPriceCents, to: liveCents };
    nextItem = { ...nextItem, unitPriceCents: liveCents };
    // If both a quantity reduction and a price change apply, surface both —
    // callers iterate the full changes[] array, not just one per item, so
    // return the price change here and let the quantity change (if any)
    // already collected above also appear (see revalidateCart's per-item loop,
    // which pushes both when present).
    change = change ? [change, priceChange] : priceChange;
  }

  return { item: nextItem, change };
}

/**
 * Revalidate an entire cart against the current live listing set.
 *
 * @param {Object} cart - a Cart (see cartModel.js); tolerated if malformed
 * @param {Object[]} liveListings - the current useMarketplaceListings() data
 * @param {Object} [opts] - reserved for future options; unused today
 * @returns {{ cart: Object, changes: Array<Object> }}
 */
export function revalidateCart(cart, liveListings, opts = {}) {
  void opts; // no options consumed yet; kept in the signature per the spec's contract
  const safeItems = Array.isArray(cart?.items) ? cart.items : [];
  if (safeItems.length === 0) {
    return { cart: cart && Array.isArray(cart.items) ? cart : { seller: null, items: [], updatedAt: Date.now() }, changes: [] };
  }

  const byKey = indexLiveListings(liveListings);
  const changes = [];
  const nextItems = safeItems.map((item) => {
    if (!item || !item.listingKey) {
      // A malformed row (missing its own key) can't be revalidated at all —
      // treat as unavailable defensively rather than throw.
      changes.push({ type: CART_CHANGE_TYPE.UNAVAILABLE, listingKey: item?.listingKey ?? null });
      return { ...(item || {}), unavailable: true };
    }
    const live = byKey.get(item.listingKey);
    const { item: revalidated, change } = revalidateItem(item, live);
    if (Array.isArray(change)) changes.push(...change);
    else if (change) changes.push(change);
    return revalidated;
  });

  return {
    cart: { seller: cart.seller ?? null, items: nextItems, updatedAt: cart.updatedAt ?? Date.now() },
    changes,
  };
}
