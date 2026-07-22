/**
 * Unit tests for cartModel.js — the pure single-seller cart core (Task 10).
 * See docs/TASK_10_CART_SPEC.md §7.
 *
 * Run with: npx vitest --run src/__tests__/cartModel.test.js
 */

import { describe, it, expect } from "vitest";
import {
  emptyCart,
  cartItemFromListing,
  addToCart,
  replaceCart,
  setQuantity,
  removeItem,
  mergeCarts,
  cartTotals,
  cartSeller,
} from "../services/cartModel.js";

// ─── Fixture builders ────────────────────────────────────────────────────────

function singleListing(overrides = {}) {
  return {
    tokenId: 101,
    seller: "0xSellerA0000000000000000000000000000001",
    commonName: "Neon Tetra",
    scientificName: "Paracheirodon innesi",
    priceUsd: "12.50",
    isBatch: false,
    isShipping: true,
    ...overrides,
  };
}

function batchListing(overrides = {}) {
  return {
    listingId: 7,
    seller: "0xSellerA0000000000000000000000000000001",
    commonName: "Guppy Fry",
    scientificName: "Poecilia reticulata",
    priceUsd: "3.00",
    quantity: 20,
    isBatch: true,
    isShipping: false,
    ...overrides,
  };
}

// ─── cartItemFromListing ─────────────────────────────────────────────────────

describe("cartItemFromListing", () => {
  it("normalizes a single listing to quantity 1 regardless of requested quantity", () => {
    const item = cartItemFromListing(singleListing(), 5);
    expect(item.isBatch).toBe(false);
    expect(item.quantity).toBe(1);
    expect(item.tokenId).toBe(101);
    expect(item.listingKey).toBe("single-101");
  });

  it("normalizes a batch listing with the requested quantity", () => {
    const item = cartItemFromListing(batchListing(), 4);
    expect(item.isBatch).toBe(true);
    expect(item.quantity).toBe(4);
    expect(item.listingId).toBe(7);
    expect(item.listingKey).toBe("batch-7");
  });

  it("lowercases the seller address", () => {
    const item = cartItemFromListing(singleListing({ seller: "0xABCDEF0000000000000000000000000000001" }));
    expect(item.seller).toBe("0xabcdef0000000000000000000000000000001");
  });

  it("derives unitPriceCents via the shared price normalizer", () => {
    const item = cartItemFromListing(singleListing({ priceUsd: "9.99" }));
    expect(item.unitPriceCents).toBe(999);
  });

  it("is deterministic aside from the addedAt timestamp", () => {
    const a = cartItemFromListing(batchListing(), 2);
    const b = cartItemFromListing(batchListing(), 2);
    const { addedAt: _a, ...restA } = a;
    const { addedAt: _b, ...restB } = b;
    expect(restA).toEqual(restB);
  });
});

// ─── Single-seller invariant (criterion 1) ──────────────────────────────────

describe("addToCart — single-seller invariant", () => {
  it("adding to an empty cart adopts the listing's seller", () => {
    const { cart, conflict } = addToCart(emptyCart(), singleListing());
    expect(conflict).toBeUndefined();
    expect(cart.seller).toBe("0xsellera0000000000000000000000000000001");
    expect(cart.items.length).toBe(1);
  });

  it("adding a different seller's item to a non-empty cart returns a conflict and does not mutate", () => {
    const { cart: cartA } = addToCart(emptyCart(), singleListing());
    const otherSellerListing = batchListing({ seller: "0xSellerB0000000000000000000000000000002" });
    const result = addToCart(cartA, otherSellerListing, 3);

    expect(result.conflict).toBeDefined();
    expect(result.conflict.currentSeller).toBe("0xsellera0000000000000000000000000000001");
    expect(result.conflict.incomingSeller).toBe("0xsellerb0000000000000000000000000000002");
    expect(result.conflict.incomingItem.listingKey).toBe("batch-7");
    // Cart is returned unchanged (same items).
    expect(result.cart).toEqual(cartA);
  });

  it("addToCart never mutates its input cart object", () => {
    const { cart: cartA } = addToCart(emptyCart(), singleListing());
    const snapshotBefore = JSON.parse(JSON.stringify(cartA));
    addToCart(cartA, batchListing({ seller: "0xSellerB0000000000000000000000000000002" }));
    expect(cartA).toEqual(snapshotBefore);
  });

  it("replaceCart yields a fresh single-item cart with the new seller", () => {
    const { cart: cartA } = addToCart(emptyCart(), singleListing());
    const replaced = replaceCart(batchListing({ seller: "0xSellerB0000000000000000000000000000002" }), 5);
    expect(replaced.seller).toBe("0xsellerb0000000000000000000000000000002");
    expect(replaced.items.length).toBe(1);
    expect(replaced.items[0].quantity).toBe(5);
    // The original cart is untouched.
    expect(cartA.seller).toBe("0xsellera0000000000000000000000000000001");
  });
});

// ─── Quantity + merge (criterion 2) ─────────────────────────────────────────

describe("addToCart — quantity merge on same-seller re-add", () => {
  it("merges quantity onto the existing row for a same-seller batch re-add", () => {
    const { cart: cartA } = addToCart(emptyCart(), batchListing(), 3);
    const { cart: cartB, conflict } = addToCart(cartA, batchListing(), 4);
    expect(conflict).toBeUndefined();
    expect(cartB.items.length).toBe(1);
    expect(cartB.items[0].quantity).toBe(7);
  });

  it("clamps merged batch quantity to the listing's available quantity", () => {
    const { cart: cartA } = addToCart(emptyCart(), batchListing({ quantity: 5 }), 3);
    const { cart: cartB } = addToCart(cartA, batchListing({ quantity: 5 }), 10);
    expect(cartB.items[0].quantity).toBe(5);
  });

  it("a single re-added stays at quantity 1 (cannot exceed 1)", () => {
    const { cart: cartA } = addToCart(emptyCart(), singleListing());
    const { cart: cartB } = addToCart(cartA, singleListing(), 3);
    expect(cartB.items.length).toBe(1);
    expect(cartB.items[0].quantity).toBe(1);
  });

  it("adding a different listing from the same seller appends a new row", () => {
    const { cart: cartA } = addToCart(emptyCart(), singleListing());
    const { cart: cartB } = addToCart(cartA, batchListing());
    expect(cartB.items.length).toBe(2);
    expect(cartB.seller).toBe("0xsellera0000000000000000000000000000001");
  });

  it("re-adding refreshes the carted unit price to the listing's current price", () => {
    const { cart: cartA } = addToCart(emptyCart(), batchListing({ priceUsd: "3.00" }), 2);
    expect(cartA.items[0].unitPriceCents).toBe(300);
    const { cart: cartB } = addToCart(cartA, batchListing({ priceUsd: "3.50" }), 1);
    expect(cartB.items[0].unitPriceCents).toBe(350);
  });
});

describe("mergeCarts", () => {
  it("returns the incoming cart when the base is empty", () => {
    const { cart: incoming } = addToCart(emptyCart(), singleListing());
    const result = mergeCarts(emptyCart(), incoming);
    expect(result.kept).toBe("incoming");
    expect(result.cart).toEqual(incoming);
  });

  it("returns the base cart when the incoming is empty", () => {
    const { cart: base } = addToCart(emptyCart(), singleListing());
    const result = mergeCarts(base, emptyCart());
    expect(result.kept).toBe("base");
    expect(result.cart).toEqual(base);
  });

  it("unions same-seller carts and sums quantities on shared listingKeys", () => {
    const { cart: base } = addToCart(emptyCart(), batchListing(), 3);
    const { cart: incoming } = addToCart(emptyCart(), batchListing(), 4);
    const result = mergeCarts(base, incoming);
    expect(result.kept).toBe("merged");
    expect(result.cart.items.length).toBe(1);
    expect(result.cart.items[0].quantity).toBe(7);
  });

  it("unions same-seller carts with distinct listingKeys into a combined item list", () => {
    const { cart: base } = addToCart(emptyCart(), singleListing());
    const { cart: incoming } = addToCart(emptyCart(), batchListing());
    const result = mergeCarts(base, incoming);
    expect(result.cart.items.length).toBe(2);
  });

  it("on seller mismatch, keeps the most-recently-updated cart and reports which was discarded", () => {
    const { cart: base } = addToCart(emptyCart(), singleListing());
    const olderBase = { ...base, updatedAt: 1000 };
    const { cart: incomingRaw } = addToCart(emptyCart(), batchListing({ seller: "0xSellerB0000000000000000000000000000002" }));
    const newerIncoming = { ...incomingRaw, updatedAt: 5000 };

    const result = mergeCarts(olderBase, newerIncoming);
    expect(result.kept).toBe("incoming");
    expect(result.cart.seller).toBe("0xsellerb0000000000000000000000000000002");
    expect(result.discarded.seller).toBe("0xsellera0000000000000000000000000000001");
  });

  it("does not mutate either input cart", () => {
    const { cart: base } = addToCart(emptyCart(), batchListing(), 3);
    const { cart: incoming } = addToCart(emptyCart(), batchListing(), 4);
    const baseSnapshot = JSON.parse(JSON.stringify(base));
    const incomingSnapshot = JSON.parse(JSON.stringify(incoming));
    mergeCarts(base, incoming);
    expect(base).toEqual(baseSnapshot);
    expect(incoming).toEqual(incomingSnapshot);
  });
});

// ─── setQuantity / removeItem ────────────────────────────────────────────────

describe("setQuantity", () => {
  it("updates a batch item's quantity, clamped to availability", () => {
    const { cart } = addToCart(emptyCart(), batchListing({ quantity: 10 }), 2);
    const updated = setQuantity(cart, "batch-7", 8);
    expect(updated.items[0].quantity).toBe(8);
    const overClamped = setQuantity(cart, "batch-7", 50);
    expect(overClamped.items[0].quantity).toBe(10);
  });

  it("setting quantity to 0 or below removes the item", () => {
    const { cart } = addToCart(emptyCart(), batchListing(), 2);
    const updated = setQuantity(cart, "batch-7", 0);
    expect(updated.items.length).toBe(0);
    expect(updated.seller).toBeNull();
  });

  it("is a no-op for a single item (always quantity 1)", () => {
    const { cart } = addToCart(emptyCart(), singleListing());
    const updated = setQuantity(cart, "single-101", 5);
    expect(updated.items[0].quantity).toBe(1);
  });

  it("does not mutate the input cart", () => {
    const { cart } = addToCart(emptyCart(), batchListing(), 2);
    const snapshot = JSON.parse(JSON.stringify(cart));
    setQuantity(cart, "batch-7", 5);
    expect(cart).toEqual(snapshot);
  });

  it("is a no-op when the listingKey is not present", () => {
    const { cart } = addToCart(emptyCart(), batchListing(), 2);
    const updated = setQuantity(cart, "single-999", 5);
    expect(updated).toEqual(cart);
  });
});

describe("removeItem", () => {
  it("removes the specified item and keeps the rest", () => {
    const { cart: c1 } = addToCart(emptyCart(), singleListing());
    const { cart: c2 } = addToCart(c1, batchListing());
    const updated = removeItem(c2, "single-101");
    expect(updated.items.length).toBe(1);
    expect(updated.items[0].listingKey).toBe("batch-7");
  });

  it("removing the last item yields an empty cart (seller cleared)", () => {
    const { cart } = addToCart(emptyCart(), singleListing());
    const updated = removeItem(cart, "single-101");
    expect(updated.items.length).toBe(0);
    expect(updated.seller).toBeNull();
  });

  it("does not mutate the input cart", () => {
    const { cart } = addToCart(emptyCart(), singleListing());
    const snapshot = JSON.parse(JSON.stringify(cart));
    removeItem(cart, "single-101");
    expect(cart).toEqual(snapshot);
  });
});

// ─── Totals (criterion 3) ────────────────────────────────────────────────────

describe("cartTotals", () => {
  it("sums itemCount and subtotalCents in integer cents", () => {
    const { cart: c1 } = addToCart(emptyCart(), singleListing({ priceUsd: "12.50" }));
    const { cart: c2 } = addToCart(c1, batchListing({ priceUsd: "3.00" }), 4);
    const totals = cartTotals(c2);
    expect(totals.distinctItems).toBe(2);
    expect(totals.itemCount).toBe(1 + 4);
    expect(totals.subtotalCents).toBe(1250 + 300 * 4);
    expect(totals.subtotalDisplay).toBe(`$${(2450 / 100).toFixed(2)}`);
  });

  it("excludes unavailable rows from totals but doesn't need them removed from the cart", () => {
    const { cart } = addToCart(emptyCart(), singleListing({ priceUsd: "12.50" }));
    const withUnavailable = { ...cart, items: [{ ...cart.items[0], unavailable: true }] };
    const totals = cartTotals(withUnavailable);
    expect(totals.itemCount).toBe(0);
    expect(totals.subtotalCents).toBe(0);
    expect(totals.distinctItems).toBe(0);
  });

  it("an empty cart totals to zero without throwing", () => {
    expect(cartTotals(emptyCart())).toEqual({
      itemCount: 0,
      distinctItems: 0,
      subtotalCents: 0,
      subtotalDisplay: "$0.00",
    });
  });

  it("handles a malformed/undefined cart without throwing", () => {
    expect(() => cartTotals(undefined)).not.toThrow();
    expect(() => cartTotals(null)).not.toThrow();
    expect(cartTotals(undefined).subtotalCents).toBe(0);
  });
});

describe("cartSeller", () => {
  it("returns null for an empty cart", () => {
    expect(cartSeller(emptyCart())).toBeNull();
  });

  it("returns the seller for a populated cart", () => {
    const { cart } = addToCart(emptyCart(), singleListing());
    expect(cartSeller(cart)).toBe("0xsellera0000000000000000000000000000001");
  });
});

// ─── Immutability / determinism (criterion 4) ───────────────────────────────

describe("immutability + determinism across the whole model", () => {
  it("every function returns a new top-level cart object (referential inequality)", () => {
    const { cart: c1 } = addToCart(emptyCart(), singleListing());
    const c2 = setQuantity(c1, "single-101", 1);
    const c3 = removeItem(c2, "single-101");
    expect(c1).not.toBe(emptyCart());
    expect(c2).not.toBe(c1);
    expect(c3).not.toBe(c2);
  });

  it("identical inputs produce identical (deep-equal) outputs", () => {
    const build = () => {
      const { cart: a } = addToCart(emptyCart(), singleListing());
      return addToCart(a, batchListing(), 2).cart;
    };
    const r1 = build();
    const r2 = build();
    const { items: items1, ...rest1 } = r1;
    const { items: items2, ...rest2 } = r2;
    // addedAt differs by wall clock across the two builds; compare structure
    // minus that volatile field.
    const stripAddedAt = (items) => items.map(({ addedAt, ...r }) => r);
    expect(stripAddedAt(items1)).toEqual(stripAddedAt(items2));
    expect(rest1.seller).toEqual(rest2.seller);
  });
});
