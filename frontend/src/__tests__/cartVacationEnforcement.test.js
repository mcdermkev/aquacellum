/**
 * Vacation mode enforcement at the checkout gate.
 *
 * THIS IS THE TEST THAT MAKES THE FEATURE SAFE TO SHIP. A "pause my store" switch
 * that writes a flag nothing honours is the most dangerous dead control in this app:
 * the breeder believes the store is closed while orders for live animals keep
 * arriving. `services/sellerVacation.js` decides who is paused; this asserts
 * `revalidateCart` actually acts on it.
 *
 * The distinction from an ordinary unavailable item is deliberate too. SELLER_PAUSED
 * is its own change type so the UI can say "away until the 20th" rather than "no
 * longer available" — same effect on the total, but one tells the buyer to wait and
 * the other sends them elsewhere.
 *
 * Carts are built through `addToCart` rather than hand-rolled, so the item shape and
 * `listingKey` derivation match production exactly — a bespoke fixture can pass
 * while the real shape fails.
 */

import { describe, it, expect } from "vitest";
import { emptyCart, addToCart, cartTotals } from "../services/cartModel.js";
import { revalidateCart, CART_CHANGE_TYPE } from "../services/cartRevalidation.js";

const SELLER_A = "0xSellerA0000000000000000000000000000001";
const SELLER_B = "0xSellerB0000000000000000000000000000002";

function listing(overrides = {}) {
  return {
    tokenId: 101,
    seller: SELLER_A,
    commonName: "Neon Tetra",
    priceUsd: "12.50",
    isBatch: false,
    active: true,
    ...overrides,
  };
}

describe("a paused seller cannot take an order", () => {
  it("marks the item unavailable even though its listing is live", () => {
    // The crux: a paused seller's listings stay perfectly valid and active. The
    // block is a property of the seller right now, not of the listing, so checking
    // listing state alone would let the order straight through.
    const { cart } = addToCart(emptyCart(), listing());
    const live = [listing()];

    const { cart: next, changes } = revalidateCart(cart, live, {
      pausedSellers: new Set([SELLER_A.toLowerCase()]),
    });

    expect(next.items[0].unavailable).toBe(true);
    expect(changes.some((c) => c.type === CART_CHANGE_TYPE.SELLER_PAUSED)).toBe(true);
  });

  it("excludes the paused item from the checkout total", () => {
    // The actual protection. Flagging without excluding would still let the order
    // through at the price of a confusing badge.
    const { cart } = addToCart(emptyCart(), listing());
    const { cart: next } = revalidateCart(cart, [listing()], {
      pausedSellers: new Set([SELLER_A.toLowerCase()]),
    });

    expect(cartTotals(next).subtotalCents).toBe(0);
  });

  it("reports SELLER_PAUSED rather than a generic UNAVAILABLE", () => {
    const { cart } = addToCart(emptyCart(), listing());
    const { changes } = revalidateCart(cart, [listing()], {
      pausedSellers: new Set([SELLER_A.toLowerCase()]),
    });

    expect(changes[0].type).toBe(CART_CHANGE_TYPE.SELLER_PAUSED);
  });

  it("matches the seller case-insensitively", () => {
    // Wallet casing is inconsistent across this schema; a case-sensitive compare
    // would silently fail to pause the seller.
    const { cart } = addToCart(emptyCart(), listing());
    const { cart: next } = revalidateCart(cart, [listing()], {
      pausedSellers: new Set([SELLER_A.toLowerCase()]),
    });
    expect(next.items[0].unavailable).toBe(true);
  });

  it("does not re-fire the change on a second pass", () => {
    // Otherwise the buyer gets the same banner on every focus event.
    const { cart } = addToCart(emptyCart(), listing());
    const paused = new Set([SELLER_A.toLowerCase()]);

    const first = revalidateCart(cart, [listing()], { pausedSellers: paused });
    const second = revalidateCart(first.cart, [listing()], { pausedSellers: paused });

    expect(first.changes.filter((c) => c.type === CART_CHANGE_TYPE.SELLER_PAUSED)).toHaveLength(1);
    expect(second.changes).toHaveLength(0);
    expect(second.cart.items[0].unavailable).toBe(true);
  });
});

describe("an available seller is untouched", () => {
  it("leaves items purchasable when nobody is paused", () => {
    const { cart } = addToCart(emptyCart(), listing());
    const { cart: next, changes } = revalidateCart(cart, [listing()], {
      pausedSellers: new Set(),
    });

    expect(next.items[0].unavailable).toBe(false);
    expect(changes.some((c) => c.type === CART_CHANGE_TYPE.SELLER_PAUSED)).toBe(false);
    expect(cartTotals(next).subtotalCents).toBeGreaterThan(0);
  });

  it("FAILS OPEN when no paused set is supplied at all", () => {
    // Backwards compatibility, and the safe default. A missing lookup must not
    // block checkout for a seller who is actually available — that would turn a
    // transient database blip into lost sales, which is the silent failure.
    const { cart } = addToCart(emptyCart(), listing());
    const { cart: next, changes } = revalidateCart(cart, [listing()]);

    expect(next.items[0].unavailable).toBe(false);
    expect(changes).toHaveLength(0);
  });

  it("FAILS OPEN when pausedSellers is the wrong type", () => {
    const { cart } = addToCart(emptyCart(), listing());
    const { cart: next } = revalidateCart(cart, [listing()], {
      pausedSellers: [SELLER_A.toLowerCase()], // an Array, not a Set — ignore, don't trust
    });
    expect(next.items[0].unavailable).toBe(false);
  });

  it("only blocks the paused seller, not a co-resident one", () => {
    // Carts are single-seller in this app, but the check must still be per-item
    // rather than blanket, so a shared cart never over-blocks.
    const { cart } = addToCart(emptyCart(), listing({ seller: SELLER_B, tokenId: 202 }));
    const { cart: next } = revalidateCart(cart, [listing({ seller: SELLER_B, tokenId: 202 })], {
      pausedSellers: new Set([SELLER_A.toLowerCase()]),
    });

    expect(next.items[0].unavailable).toBe(false);
  });
});

describe("returning from vacation restores the cart", () => {
  it("clears the pause marker so the item becomes purchasable again", () => {
    // A buyer should not have to re-add an item just because the seller was
    // briefly away — auto-resume has to reach the cart, not just the database.
    const { cart } = addToCart(emptyCart(), listing());

    const paused = revalidateCart(cart, [listing()], {
      pausedSellers: new Set([SELLER_A.toLowerCase()]),
    });
    expect(paused.cart.items[0].unavailable).toBe(true);

    const resumed = revalidateCart(paused.cart, [listing()], { pausedSellers: new Set() });

    expect(resumed.cart.items[0].unavailable).toBe(false);
    expect(resumed.cart.items[0].pausedSeller).toBe(false);
    expect(cartTotals(resumed.cart).subtotalCents).toBeGreaterThan(0);
  });
});
