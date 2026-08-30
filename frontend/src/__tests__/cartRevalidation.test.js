/**
 * Unit tests for cartRevalidation.js — the Opus-review-gated cart-vs-live-
 * catalog reconciliation core (Task 10, §4/§7 criterion 5). See
 * docs/TASK_10_CART_SPEC.md §4.
 *
 * Run with: npx vitest --run src/__tests__/cartRevalidation.test.js
 */

import { describe, it, expect } from "vitest";
import { emptyCart, addToCart, cartTotals } from "../services/cartModel.js";
import { revalidateCart, CART_CHANGE_TYPE } from "../services/cartRevalidation.js";
import { containsProhibitedTerm } from "../services/orderCopy.js";

function singleListing(overrides = {}) {
  return {
    tokenId: 101,
    seller: "0xSellerA0000000000000000000000000000001",
    commonName: "Neon Tetra",
    priceUsd: "12.50",
    isBatch: false,
    active: true,
    ...overrides,
  };
}

function batchListing(overrides = {}) {
  return {
    listingId: 7,
    seller: "0xSellerA0000000000000000000000000000001",
    commonName: "Guppy Fry",
    priceUsd: "3.00",
    quantity: 20,
    isBatch: true,
    isActive: true,
    ...overrides,
  };
}

// ─── Unavailable detection ───────────────────────────────────────────────────

describe("revalidateCart — unavailable detection", () => {
  it("marks a single unavailable when no matching live listing exists (delisted)", () => {
    const { cart } = addToCart(emptyCart(), singleListing());
    const { cart: revalidated, changes } = revalidateCart(cart, []); // no live listings at all
    expect(revalidated.items[0].unavailable).toBe(true);
    expect(changes).toEqual([{ type: CART_CHANGE_TYPE.UNAVAILABLE, listingKey: "single-101" }]);
    // Never dropped — still present in the cart.
    expect(revalidated.items.length).toBe(1);
  });

  it("marks a single unavailable when the live listing is explicitly inactive", () => {
    const { cart } = addToCart(emptyCart(), singleListing());
    const live = [singleListing({ active: false })];
    const { cart: revalidated, changes } = revalidateCart(cart, live);
    expect(revalidated.items[0].unavailable).toBe(true);
    expect(changes[0].type).toBe(CART_CHANGE_TYPE.UNAVAILABLE);
  });

  it("marks a single unavailable when its tokenId no longer resolves on the live listing", () => {
    const { cart } = addToCart(emptyCart(), singleListing({ tokenId: 101 }));
    // Live listing with the SAME listingKey slot but a different/missing tokenId
    // shouldn't happen in practice (listingKey is derived from tokenId), but
    // defensively verify: a live entry with no tokenId at all is unavailable.
    const live = [{ ...singleListing({ tokenId: 101 }), tokenId: undefined, id: undefined }];
    const { cart: revalidated } = revalidateCart(cart, live);
    expect(revalidated.items[0].unavailable).toBe(true);
  });

  it("marks a batch unavailable when live quantity has dropped to zero", () => {
    const { cart } = addToCart(emptyCart(), batchListing({ quantity: 5 }), 3);
    const live = [batchListing({ quantity: 0 })];
    const { cart: revalidated, changes } = revalidateCart(cart, live);
    expect(revalidated.items[0].unavailable).toBe(true);
    expect(changes[0].type).toBe(CART_CHANGE_TYPE.UNAVAILABLE);
  });

  it("marks a batch unavailable when the live listing is explicitly inactive", () => {
    const { cart } = addToCart(emptyCart(), batchListing(), 3);
    const live = [batchListing({ isActive: false })];
    const { cart: revalidated } = revalidateCart(cart, live);
    expect(revalidated.items[0].unavailable).toBe(true);
  });

  it("a previously-unavailable item becomes available again if the live listing reappears", () => {
    const { cart } = addToCart(emptyCart(), singleListing());
    const gone = revalidateCart(cart, []).cart;
    expect(gone.items[0].unavailable).toBe(true);
    const restored = revalidateCart(gone, [singleListing()]).cart;
    expect(restored.items[0].unavailable).toBe(false);
  });

  it("does not re-emit an unavailable change on every pass once already flagged", () => {
    const { cart } = addToCart(emptyCart(), singleListing());
    const firstPass = revalidateCart(cart, []);
    expect(firstPass.changes.length).toBe(1);
    const secondPass = revalidateCart(firstPass.cart, []);
    expect(secondPass.changes.length).toBe(0);
    expect(secondPass.cart.items[0].unavailable).toBe(true);
  });
});

// ─── Quantity reduced ────────────────────────────────────────────────────────

describe("revalidateCart — quantity reduced", () => {
  it("clamps carted quantity down when live stock is lower, recording a quantity_reduced change", () => {
    const { cart } = addToCart(emptyCart(), batchListing({ quantity: 20 }), 10);
    const live = [batchListing({ quantity: 4 })];
    const { cart: revalidated, changes } = revalidateCart(cart, live);
    expect(revalidated.items[0].quantity).toBe(4);
    expect(revalidated.items[0].unavailable).toBe(false);
    expect(changes).toEqual([{ type: CART_CHANGE_TYPE.QUANTITY_REDUCED, listingKey: "batch-7", from: 10, to: 4 }]);
  });

  it("does not touch quantity when live stock still covers the carted amount", () => {
    const { cart } = addToCart(emptyCart(), batchListing({ quantity: 20 }), 5);
    const live = [batchListing({ quantity: 20 })];
    const { cart: revalidated, changes } = revalidateCart(cart, live);
    expect(revalidated.items[0].quantity).toBe(5);
    expect(changes.length).toBe(0);
  });

  it("never reduces a single's quantity (always 1, no reduction concept applies)", () => {
    const { cart } = addToCart(emptyCart(), singleListing());
    const { cart: revalidated, changes } = revalidateCart(cart, [singleListing()]);
    expect(revalidated.items[0].quantity).toBe(1);
    expect(changes.length).toBe(0);
  });
});

// ─── Price changed ───────────────────────────────────────────────────────────

describe("revalidateCart — price changed", () => {
  it("updates unitPriceCents and records a price_changed entry when live price differs", () => {
    const { cart } = addToCart(emptyCart(), singleListing({ priceUsd: "12.50" }));
    const live = [singleListing({ priceUsd: "15.00" })];
    const { cart: revalidated, changes } = revalidateCart(cart, live);
    expect(revalidated.items[0].unitPriceCents).toBe(1500);
    expect(changes).toEqual([{ type: CART_CHANGE_TYPE.PRICE_CHANGED, listingKey: "single-101", from: 1250, to: 1500 }]);
  });

  it("no change record when the live price matches the carted price", () => {
    const { cart } = addToCart(emptyCart(), singleListing({ priceUsd: "12.50" }));
    const { changes } = revalidateCart(cart, [singleListing({ priceUsd: "12.50" })]);
    expect(changes.length).toBe(0);
  });

  it("a price change never carries a stale price forward — the corrected cart always reflects live price", () => {
    const { cart } = addToCart(emptyCart(), batchListing({ priceUsd: "3.00" }), 5);
    const live = [batchListing({ priceUsd: "3.50" })];
    const { cart: revalidated } = revalidateCart(cart, live);
    const totals = cartTotals(revalidated);
    expect(totals.subtotalCents).toBe(350 * 5);
  });

  it("both a price change and a quantity reduction can apply to the same item in one pass", () => {
    const { cart } = addToCart(emptyCart(), batchListing({ priceUsd: "3.00", quantity: 20 }), 10);
    const live = [batchListing({ priceUsd: "4.00", quantity: 2 })];
    const { cart: revalidated, changes } = revalidateCart(cart, live);
    expect(revalidated.items[0].quantity).toBe(2);
    expect(revalidated.items[0].unitPriceCents).toBe(400);
    expect(changes.some((c) => c.type === CART_CHANGE_TYPE.QUANTITY_REDUCED)).toBe(true);
    expect(changes.some((c) => c.type === CART_CHANGE_TYPE.PRICE_CHANGED)).toBe(true);
    expect(changes.length).toBe(2);
  });
});

// ─── Defensive: malformed/missing input never throws ────────────────────────

describe("revalidateCart — defensive behavior", () => {
  it("treats a malformed live listing (missing key fields) as unavailable, no throw", () => {
    const { cart } = addToCart(emptyCart(), singleListing());
    expect(() => revalidateCart(cart, [{ garbage: true }])).not.toThrow();
    const { cart: revalidated } = revalidateCart(cart, [{ garbage: true }]);
    expect(revalidated.items[0].unavailable).toBe(true);
  });

  it("tolerates a non-array liveListings argument without throwing", () => {
    const { cart } = addToCart(emptyCart(), singleListing());
    expect(() => revalidateCart(cart, null)).not.toThrow();
    expect(() => revalidateCart(cart, undefined)).not.toThrow();
    expect(() => revalidateCart(cart, "not-an-array")).not.toThrow();
    expect(revalidateCart(cart, null).cart.items[0].unavailable).toBe(true);
  });

  it("tolerates a malformed cart without throwing", () => {
    expect(() => revalidateCart(null, [])).not.toThrow();
    expect(() => revalidateCart(undefined, [])).not.toThrow();
    expect(() => revalidateCart({}, [])).not.toThrow();
  });

  it("tolerates a cart item missing its own listingKey without throwing", () => {
    const brokenCart = { seller: "0xseller", items: [{ commonName: "ghost" }], updatedAt: Date.now() };
    expect(() => revalidateCart(brokenCart, [])).not.toThrow();
    const { cart, changes } = revalidateCart(brokenCart, []);
    expect(cart.items[0].unavailable).toBe(true);
    expect(changes.length).toBe(1);
  });

  it("an empty cart revalidates to an empty cart with no changes", () => {
    const { cart, changes } = revalidateCart(emptyCart(), [singleListing()]);
    expect(cart.items).toEqual([]);
    expect(changes).toEqual([]);
  });
});

// ─── Never mutates, never calls network, never drops ────────────────────────

describe("revalidateCart — never drops, never mutates input", () => {
  it("does not mutate the input cart object", () => {
    const { cart } = addToCart(emptyCart(), batchListing({ quantity: 20 }), 10);
    const snapshot = JSON.parse(JSON.stringify(cart));
    revalidateCart(cart, [batchListing({ quantity: 2 })]);
    expect(cart).toEqual(snapshot);
  });

  it("keeps unavailable items in the cart rather than removing them", () => {
    const { cart: c1 } = addToCart(emptyCart(), singleListing());
    const { cart: c2 } = addToCart(c1, batchListing());
    const { cart: revalidated } = revalidateCart(c2, [batchListing()]); // single is now delisted
    expect(revalidated.items.length).toBe(2);
    const singleRow = revalidated.items.find((i) => i.listingKey === "single-101");
    expect(singleRow.unavailable).toBe(true);
  });

  it("is deterministic: identical inputs produce identical outputs", () => {
    const { cart } = addToCart(emptyCart(), batchListing({ quantity: 20 }), 10);
    const live = [batchListing({ quantity: 3, priceUsd: "5.00" })];
    const a = revalidateCart(cart, live);
    const b = revalidateCart(cart, live);
    expect(a).toEqual(b);
  });

  it("preserves the snapshot-bound server revision used for the next CAS write", () => {
    const { cart } = addToCart(emptyCart(), singleListing());
    const revalidated = revalidateCart({ ...cart, serverRevision: 9 }, [singleListing()]);
    expect(revalidated.cart.serverRevision).toBe(9);
  });
});

// ─── Web2 language invariant (criterion 6) ──────────────────────────────────
// revalidateCart itself returns structured data, not copy — but the change
// `type` values must be safe strings a UI could turn directly into a label,
// and this module must never introduce Web3 terminology anywhere in its
// output (defensive check that the module stays pure data/no copy strings).

describe("Web2 language invariant", () => {
  it("CART_CHANGE_TYPE values contain no prohibited terms", () => {
    for (const type of Object.values(CART_CHANGE_TYPE)) {
      expect(containsProhibitedTerm(type)).toBe(false);
    }
  });
});
