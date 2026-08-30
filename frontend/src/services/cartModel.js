/**
 * cartModel.js
 *
 * Pure, dependency-free cart model (Task 10, Tier B). No React, no Dexie, no
 * fetch — every function takes a cart (or nothing) and returns a new cart,
 * never mutating its inputs. This is the single-seller invariant + quantity/
 * merge/totals core that `cartStore.js` persists and `CartContext.jsx`
 * exposes to components.
 *
 * See docs/TASK_10_CART_SPEC.md §3. Composes catalogQuery.js's identity/price
 * primitives rather than re-deriving them.
 *
 * Cart shape:
 *   { seller: string|null, items: CartItem[], updatedAt: number }
 *
 * CartItem shape:
 *   {
 *     id,                 // === listingKey (one row per listing)
 *     listingKey,
 *     tokenId, listingId,  // whichever applies
 *     isBatch,
 *     seller,              // lowercased wallet
 *     sellerName,          // optional display name/alias snapshot
 *     speciesId, commonName, scientificName, imageUrl,
 *     unitPriceCents,       // authoritative price is set by revalidation, not here
 *     quantity,
 *     fulfillmentTypes,     // string[] from getFulfillmentTypes
 *     addedAt,              // epoch ms
 *     unavailable,          // set only by revalidateCart, defaults to false
 *     snapshot,             // the raw listing fields captured at add-time
 *   }
 */

import { getListingKey, normalizePriceCents, formatPriceCents, getFulfillmentTypes } from "./catalogQuery.js";

// ─── Empty cart ──────────────────────────────────────────────────────────────

/**
 * A fresh, empty cart.
 * @returns {Object}
 */
export function emptyCart() {
  return { seller: null, items: [], updatedAt: Date.now() };
}

/** Normalize a possibly-undefined/malformed cart into a safe shape. */
function normalizeCart(cart) {
  if (!cart || !Array.isArray(cart.items)) return emptyCart();
  return {
    seller: cart.seller ?? null,
    items: cart.items,
    updatedAt: cart.updatedAt ?? Date.now(),
    serverRevision: Number.isSafeInteger(Number(cart.serverRevision)) ? Number(cart.serverRevision) : 0,
  };
}

// ─── Cart-item construction ──────────────────────────────────────────────────

/**
 * Build the normalized cart-item shape from a raw listing (any of the mixed
 * shapes catalogQuery.js already handles — on-chain, cloud, local).
 *
 * Singles are always quantity 1 (a specimen is one unique item); batch
 * listings carry a per-fish price and an explicit quantity.
 *
 * @param {Object} listing
 * @param {number} [quantity=1]
 * @returns {Object} a CartItem
 */
export function cartItemFromListing(listing = {}, quantity = 1) {
  const listingKey = getListingKey(listing);
  const isBatch = !!listing.isBatch;
  const qty = isBatch ? Math.max(1, Math.round(Number(quantity) || 1)) : 1;

  return {
    id: listingKey,
    listingKey,
    tokenId: isBatch ? null : (listing.tokenId ?? listing.id ?? null),
    listingId: isBatch ? (listing.listingId ?? listing.id ?? null) : null,
    isBatch,
    seller: (listing.seller || "").toLowerCase(),
    sellerName: listing.sellerName || null,
    speciesId: listing.speciesId ?? null,
    commonName: listing.commonName || "",
    scientificName: listing.scientificName || "",
    imageUrl: listing.imageUrl || listing.photoUrl || null,
    unitPriceCents: normalizePriceCents(listing),
    quantity: qty,
    fulfillmentTypes: getFulfillmentTypes(listing),
    addedAt: Date.now(),
    unavailable: false,
    snapshot: {
      commonName: listing.commonName || "",
      scientificName: listing.scientificName || "",
      priceCents: normalizePriceCents(listing),
      quantityAvailable: isBatch ? Number(listing.quantity) || 0 : 1,
    },
  };
}

// ─── Single-seller add / replace ────────────────────────────────────────────

/**
 * Add a listing to the cart, enforcing the single-seller invariant.
 *
 * - Empty cart: appends the item, adopts the listing's seller.
 * - Same seller: merges quantity onto the existing row (clamped — batch to
 *   the listing's available quantity, singles can never exceed 1), or
 *   appends a new row if the listingKey isn't already present.
 * - Different seller: does NOT mutate; returns a `conflict` descriptor so
 *   the caller can prompt "replace cart?" before calling `replaceCart`.
 *
 * @param {Object} cart
 * @param {Object} listing
 * @param {number} [quantity=1]
 * @returns {{ cart: Object, conflict?: { currentSeller:string, currentSellerName?:string, incomingSeller:string, incomingItem:Object } }}
 */
export function addToCart(cart, listing, quantity = 1) {
  const safeCart = normalizeCart(cart);
  const incomingSeller = (listing?.seller || "").toLowerCase();
  const incomingItem = cartItemFromListing(listing, quantity);

  if (safeCart.items.length === 0) {
    return {
      cart: {
        seller: incomingSeller || null,
        items: [incomingItem],
        updatedAt: Date.now(),
        serverRevision: safeCart.serverRevision,
      },
    };
  }

  if (safeCart.seller && incomingSeller && safeCart.seller !== incomingSeller) {
    const currentItem = safeCart.items[0];
    return {
      cart: safeCart,
      conflict: {
        currentSeller: safeCart.seller,
        currentSellerName: currentItem?.sellerName || null,
        incomingSeller,
        incomingItem,
      },
    };
  }

  // Same seller — merge quantity on an existing row, or append.
  const existingIdx = safeCart.items.findIndex((i) => i.listingKey === incomingItem.listingKey);
  if (existingIdx === -1) {
    return {
      cart: { ...safeCart, items: [...safeCart.items, incomingItem], updatedAt: Date.now() },
    };
  }

  const existing = safeCart.items[existingIdx];
  const available = Number(incomingItem.snapshot.quantityAvailable) || Infinity;
  const mergedQuantity = existing.isBatch
    ? Math.min(available, existing.quantity + incomingItem.quantity)
    : 1; // singles can't exceed 1

  const nextItems = safeCart.items.slice();
  nextItems[existingIdx] = {
    ...existing,
    quantity: mergedQuantity,
    unitPriceCents: incomingItem.unitPriceCents, // refresh price on re-add
    unavailable: false,
  };

  return { cart: { ...safeCart, items: nextItems, updatedAt: Date.now() } };
}

/**
 * Replace the entire cart with a single fresh item from `listing` — the
 * "yes, replace" resolution of a seller conflict.
 * @param {Object} listing
 * @param {number} [quantity=1]
 * @returns {Object} a fresh single-item cart
 */
export function replaceCart(listing, quantity = 1) {
  const item = cartItemFromListing(listing, quantity);
  return { seller: item.seller || null, items: [item], updatedAt: Date.now() };
}

// ─── Quantity / removal ──────────────────────────────────────────────────────

/**
 * Set the quantity of a cart line (by listingKey). Clamped to
 * [1, quantityAvailable] for batch rows; singles are always 1 (a no-op).
 * Setting quantity to 0 or below removes the item (same as removeItem).
 * @param {Object} cart
 * @param {string} listingKey
 * @param {number} quantity
 * @returns {Object} a new cart
 */
export function setQuantity(cart, listingKey, quantity) {
  const safeCart = normalizeCart(cart);
  const idx = safeCart.items.findIndex((i) => i.listingKey === listingKey);
  if (idx === -1) return safeCart;

  const qty = Math.round(Number(quantity) || 0);
  if (qty <= 0) return removeItem(safeCart, listingKey);

  const item = safeCart.items[idx];
  if (!item.isBatch) return safeCart; // singles are always 1

  const available = Number(item.snapshot?.quantityAvailable) || Infinity;
  const clamped = Math.max(1, Math.min(available, qty));

  const nextItems = safeCart.items.slice();
  nextItems[idx] = { ...item, quantity: clamped };
  return { ...safeCart, items: nextItems, updatedAt: Date.now() };
}

/**
 * Remove a cart line by listingKey. Removing the last item yields an empty
 * cart (seller cleared).
 * @param {Object} cart
 * @param {string} listingKey
 * @returns {Object} a new cart
 */
export function removeItem(cart, listingKey) {
  const safeCart = normalizeCart(cart);
  const nextItems = safeCart.items.filter((i) => i.listingKey !== listingKey);
  if (nextItems.length === 0) return { ...emptyCart(), serverRevision: safeCart.serverRevision };
  return { ...safeCart, items: nextItems, updatedAt: Date.now() };
}

// ─── Merge (guest → account on login) ───────────────────────────────────────

/**
 * Merge two carts (e.g. a local guest cart into a server account cart on
 * login). Same-seller carts union their items, summing quantities on shared
 * listingKeys (clamped to each item's known available quantity). Different
 * sellers: keep whichever cart was more recently updated and discard the
 * other, so the caller can inform the user which cart survived.
 *
 * @param {Object} base - e.g. the server/account cart
 * @param {Object} incoming - e.g. the local guest cart
 * @returns {{ cart: Object, kept: ('base'|'incoming'|'merged'), discarded?: Object }}
 */
export function mergeCarts(base, incoming) {
  const safeBase = normalizeCart(base);
  const safeIncoming = normalizeCart(incoming);

  if (safeBase.items.length === 0) return { cart: safeIncoming, kept: "incoming" };
  if (safeIncoming.items.length === 0) return { cart: safeBase, kept: "base" };

  if (safeBase.seller && safeIncoming.seller && safeBase.seller !== safeIncoming.seller) {
    const baseIsNewer = (safeBase.updatedAt || 0) >= (safeIncoming.updatedAt || 0);
    return baseIsNewer
      ? { cart: safeBase, kept: "base", discarded: safeIncoming }
      : { cart: safeIncoming, kept: "incoming", discarded: safeBase };
  }

  // Same seller (or one side has no seller set, e.g. legacy empty marker):
  // union items, summing quantities on shared listingKeys.
  const merged = safeBase.items.map((i) => ({ ...i }));
  for (const incomingItem of safeIncoming.items) {
    const idx = merged.findIndex((i) => i.listingKey === incomingItem.listingKey);
    if (idx === -1) {
      merged.push({ ...incomingItem });
      continue;
    }
    const existing = merged[idx];
    const available = Number(incomingItem.snapshot?.quantityAvailable ?? existing.snapshot?.quantityAvailable) || Infinity;
    const summed = existing.isBatch
      ? Math.min(available, existing.quantity + incomingItem.quantity)
      : 1;
    merged[idx] = { ...existing, quantity: summed };
  }

  return {
    cart: {
      seller: safeBase.seller || safeIncoming.seller || null,
      items: merged,
      updatedAt: Date.now(),
      serverRevision: safeBase.serverRevision,
    },
    kept: "merged",
  };
}

// ─── Totals ──────────────────────────────────────────────────────────────────

/**
 * Sum totals over a cart's AVAILABLE items only (unavailable rows are kept
 * visible in the cart but excluded from money math). Pure integer-cents sum.
 * @param {Object} cart
 * @returns {{ itemCount:number, distinctItems:number, subtotalCents:number, subtotalDisplay:string }}
 */
export function cartTotals(cart) {
  const safeCart = normalizeCart(cart);
  const available = safeCart.items.filter((i) => !i.unavailable);

  const itemCount = available.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
  const subtotalCents = available.reduce((sum, i) => sum + (Number(i.unitPriceCents) || 0) * (Number(i.quantity) || 0), 0);

  return {
    itemCount,
    distinctItems: available.length,
    subtotalCents,
    subtotalDisplay: formatPriceCents(subtotalCents),
  };
}

/**
 * The single seller wallet for a cart, or null when empty.
 * @param {Object} cart
 * @returns {string|null}
 */
export function cartSeller(cart) {
  const safeCart = normalizeCart(cart);
  return safeCart.seller || null;
}
