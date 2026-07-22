/**
 * CartContext.jsx
 *
 * The single cart provider (Task 10, §5). Backed by cartStore.js (persistence)
 * + cartModel.js (pure model) + cartRevalidation.js (pure, review-gated
 * live-availability reconciliation). Thin — every decision (single-seller
 * invariant, quantity clamps, merge rules, revalidation) lives in those pure
 * modules; this file only wires them to React state and debounced persistence.
 *
 * Mount high enough in the tree to cover the marketplace board, product
 * detail, and checkout (see App.jsx).
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./AuthContext.jsx";
import { useMarketplaceListings } from "../hooks/useMarketplaceListings.js";
import { CONTRACT_ADDRESS, MARKETPLACE_ADDRESS } from "../config/appConfig.js";
import { loadCart, saveCart, clearCart as clearCartStore } from "../services/cartStore.js";
import {
  emptyCart,
  addToCart as addToCartModel,
  replaceCart as replaceCartModel,
  setQuantity as setQuantityModel,
  removeItem as removeItemModel,
  cartTotals,
} from "../services/cartModel.js";
import { revalidateCart } from "../services/cartRevalidation.js";

const CartContext = createContext(null);

const SAVE_DEBOUNCE_MS = 600;

export function CartProvider({ children }) {
  const { account } = useAuth();
  const [cart, setCart] = useState(emptyCart());
  const [loaded, setLoaded] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [changes, setChanges] = useState([]);

  // Same query key as MarketplaceBoard/BreederTerminal's own call — React
  // Query dedupes this to a shared cache entry rather than double-fetching,
  // per the spec's "the same source the board... uses" requirement (§1).
  const { data: liveListings = [] } = useMarketplaceListings(CONTRACT_ADDRESS, MARKETPLACE_ADDRESS);

  const saveTimerRef = useRef(null);
  const liveListingsRef = useRef(liveListings);
  liveListingsRef.current = liveListings;
  // Read via ref inside the debounced save effect so the effect can depend
  // only on [cart, loaded] (the debounce should reset on every cart change,
  // not on account, which only changes rarely and is always current here).
  const accountRef = useRef(account);
  accountRef.current = account;

  // ─── Initial load + reload on identity change (guest ↔ account, or
  // switching accounts) ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loadedCart = await loadCart({ account });
      if (cancelled) return;
      setCart(loadedCart);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [account]);

  // ─── Debounced persistence on every cart change ─────────────────────────────
  useEffect(() => {
    if (!loaded) return; // don't persist the initial empty state over a real load-in-flight
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveCart(cart, { account: accountRef.current }).catch(() => {
        // saveCart itself never throws (best-effort internally), but guard
        // defensively — a persistence failure must never surface as an
        // unhandled promise rejection in the UI layer.
      });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [cart, loaded]);

  // ─── Revalidation (§4) ───────────────────────────────────────────────────────
  const revalidate = useCallback(() => {
    const listings = liveListingsRef.current;
    if (!Array.isArray(listings)) return { changes: [] };
    const { cart: revalidatedCart, changes: newChanges } = revalidateCart(cart, listings);
    setCart(revalidatedCart);
    setChanges(newChanges);
    return { changes: newChanges };
  }, [cart]);

  // Revalidate on mount-once-loaded, and again on window focus (spec §4:
  // "on cart open, on app focus/regain, and immediately before 'Proceed to
  // checkout'"). Cart-open revalidation is triggered by the drawer itself
  // calling `revalidate()` when it opens. Reading `revalidate` via a ref
  // (rather than listing it as a dependency) keeps this effect from
  // re-attaching the focus listener on every cart change — it should attach
  // once loading completes and stay attached.
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;
  useEffect(() => {
    if (!loaded) return;
    revalidateRef.current();
    const handleFocus = () => revalidateRef.current();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loaded]);

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const addItem = useCallback((listing, quantity = 1) => {
    setCart((prevCart) => {
      const result = addToCartModel(prevCart, listing, quantity);
      if (result.conflict) {
        setConflict(result.conflict);
        return prevCart; // unchanged — addToCartModel already didn't mutate
      }
      setConflict(null);
      return result.cart;
    });
  }, []);

  const setItemQuantity = useCallback((listingKey, quantity) => {
    setCart((prevCart) => setQuantityModel(prevCart, listingKey, quantity));
  }, []);

  const removeItem = useCallback((listingKey) => {
    setCart((prevCart) => removeItemModel(prevCart, listingKey));
  }, []);

  const replaceCartWith = useCallback((listing, quantity = 1) => {
    setConflict(null);
    setCart(replaceCartModel(listing, quantity));
  }, []);

  const resolveConflict = useCallback((accept) => {
    const pending = conflict;
    setConflict(null);
    if (!pending || !accept) return;
    // conflict.incomingItem is already a fully-formed CartItem (built by
    // cartModel's addToCart via cartItemFromListing) — replace the cart with
    // it directly rather than routing back through replaceCart, which
    // expects a raw listing shape.
    setCart({ seller: pending.incomingSeller, items: [pending.incomingItem], updatedAt: Date.now() });
  }, [conflict]);

  const dismissConflict = useCallback(() => setConflict(null), []);

  const clear = useCallback(() => {
    setCart(emptyCart());
    clearCartStore({ account }).catch(() => {});
  }, [account]);

  const totals = cartTotals(cart);

  const value = {
    cart,
    loaded,
    totals,
    changes,
    conflict,
    addItem,
    setItemQuantity,
    removeItem,
    replaceCart: replaceCartWith,
    resolveConflict,
    dismissConflict,
    clear,
    revalidate,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
