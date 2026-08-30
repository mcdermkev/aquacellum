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

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "./AuthContext.jsx";
import { useMarketplaceListings } from "../hooks/useMarketplaceListings.js";
import { CONTRACT_ADDRESS, MARKETPLACE_ADDRESS } from "../config/appConfig.js";
import {
  loadCart,
  saveCart,
  resolveCartMerge,
  resolveCartRevisionConflict,
} from "../services/cartStore.js";
import {
  emptyCart,
  addToCart as addToCartModel,
  replaceCart as replaceCartModel,
  setQuantity as setQuantityModel,
  removeItem as removeItemModel,
  cartTotals,
} from "../services/cartModel.js";
import { revalidateCart } from "../services/cartRevalidation.js";
import {
  getCanonicalListingKey,
  resolveCheckoutListing,
} from "../services/catalogQuery.js";
import { getPausedSellers } from "../services/sellerVacation.js";

const CartContext = createContext(null);

const SAVE_DEBOUNCE_MS = 600;

export function CartProvider({ children }) {
  const { account, authenticated, sessionBridgeReady } = useAuth();
  const canSync = !!(account && authenticated && sessionBridgeReady);
  const [cart, setCart] = useState(emptyCart());
  const cartIdentity = account || "__guest__";
  const [loadedIdentity, setLoadedIdentity] = useState(null);
  const loaded = loadedIdentity === cartIdentity;
  const [conflict, setConflict] = useState(null);
  const [changes, setChanges] = useState([]);

  // Same query key as MarketplaceBoard/BreederTerminal's own call — React
  // Query dedupes this to a shared cache entry rather than double-fetching,
  // per the spec's "the same source the board... uses" requirement (§1).
  const {
    data: liveListings = [],
    isAuthoritative,
    authoritativeListingKeys,
    catalogRevision,
    isLoading: catalogLoading,
    isFetching: catalogFetching,
    isError: catalogError,
  } = useMarketplaceListings(CONTRACT_ADDRESS, MARKETPLACE_ADDRESS);
  const catalogAuthoritative = !!isAuthoritative && !catalogLoading && !catalogFetching && !catalogError;

  const saveTimerRef = useRef(null);
  const skipNextSaveRef = useRef(false);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const cartSaveKey = useMemo(() => JSON.stringify({
    seller: cart.seller,
    items: cart.items,
    updatedAt: cart.updatedAt,
  }), [cart.seller, cart.items, cart.updatedAt]);
  const liveListingsRef = useRef(liveListings);
  liveListingsRef.current = liveListings;
  const authoritativeKeysRef = useRef(authoritativeListingKeys);
  authoritativeKeysRef.current = authoritativeListingKeys;

  // Sellers currently on vacation. Held in a ref because `revalidate` is
  // synchronous and called from several places (mount, focus, cart open, and
  // immediately before checkout) — it cannot await a lookup.
  //
  // Fails OPEN: an empty set means "nobody is paused", so a failed or in-flight
  // lookup never blocks a checkout for a seller who is actually available. The
  // reverse default would turn a transient database blip into lost sales.
  const pausedSellersRef = useRef(new Set());
  // Read via ref inside the debounced save effect so the effect can depend
  // only on [cart, loaded] (the debounce should reset on every cart change,
  // not on account, which only changes rarely and is always current here).
  const accountRef = useRef(account);
  accountRef.current = account;
  const canSyncRef = useRef(canSync);
  canSyncRef.current = canSync;
  const catalogAuthoritativeRef = useRef(catalogAuthoritative);
  catalogAuthoritativeRef.current = catalogAuthoritative;

  const applyLoadedCart = useCallback((loadedCart) => {
    const { mergeConflict, ...cartState } = loadedCart;
    skipNextSaveRef.current = true;
    setCart(cartState);
    setConflict(mergeConflict || null);
    setLoadedIdentity(account || "__guest__");
  }, [account]);

  // ─── Initial load + reload on identity change (guest ↔ account, or
  // switching accounts) ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoadedIdentity(null);
    (async () => {
      const loadedCart = await loadCart({ account, canSync });
      if (cancelled) return;
      applyLoadedCart(loadedCart);
    })();
    return () => { cancelled = true; };
  }, [account, canSync, applyLoadedCart]);

  const retryMerge = useCallback(async () => {
    if (!account || !canSync || conflict?.type !== "merge_error") return;
    setLoadedIdentity(null);
    const loadedCart = await loadCart({ account, canSync });
    applyLoadedCart(loadedCart);
  }, [account, canSync, conflict, applyLoadedCart]);

  // ─── Debounced persistence on every cart content change ─────────────────────
  useEffect(() => {
    // Never persist either side of an unresolved reconciliation choice.
    if (!loaded || conflict?.type === "merge_error" || conflict?.type === "sync_conflict") return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const snapshot = cartRef.current;
      saveCart(snapshot, {
        account: accountRef.current,
        canSync: canSyncRef.current,
      }).then((result) => {
        if (result?.ok && result.cart) {
          // Acknowledging this tab's own queued mutation advances the lineage
          // of any newer local edit without scheduling another identical save.
          setCart((current) => ({ ...current, serverRevision: result.cart.serverRevision }));
        } else if (result?.conflict) {
          setConflict(result.conflict);
        }
      }).catch(() => {
        // saveCart is best-effort internally, but avoid an unhandled rejection
        // if local persistence itself becomes unavailable.
      });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [cartSaveKey, loaded, conflict?.type]);

  // ─── Seller vacation lookup ─────────────────────────────────────────────────
  // Keyed on a sorted, de-duplicated seller string rather than the cart object, so
  // this refetches when the cart's SELLERS change and not on every quantity tweak
  // — and so setting the ref cannot feed back into its own dependency and loop.
  const cartSellerKey = useMemo(() => {
    const sellers = (cart?.items || [])
      .map((i) => i?.sellerAddress || i?.seller || cart?.seller)
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
    return [...new Set(sellers)].sort().join(",");
  }, [cart]);

  useEffect(() => {
    if (!cartSellerKey) {
      pausedSellersRef.current = new Set();
      return;
    }
    let cancelled = false;
    (async () => {
      const paused = await getPausedSellers(cartSellerKey.split(","));
      if (cancelled) return;
      pausedSellersRef.current = paused;
      // Re-run revalidation now that we know, so a paused seller's items are
      // flagged without waiting for the next focus event.
      if (paused.size > 0) revalidateRef.current?.();
    })();
    return () => { cancelled = true; };
  }, [cartSellerKey]);

  // ─── Revalidation (§4) ───────────────────────────────────────────────────────
  const revalidate = useCallback(() => {
    const currentCart = cartRef.current;
    const listings = liveListingsRef.current;
    const ready = navigator.onLine && catalogAuthoritativeRef.current && Array.isArray(listings);
    if (!ready) {
      return {
        changes: [],
        eligible: false,
        blockers: [],
        checkoutItems: [],
        cart: currentCart,
        ready: false,
        reason: navigator.onLine
          ? "Live marketplace availability is still loading. Please try again."
          : "Reconnect to the internet before checkout.",
      };
    }
    const result = revalidateCart(currentCart, listings, {
      pausedSellers: pausedSellersRef.current,
      authoritativeKeys: authoritativeKeysRef.current,
    });
    setCart(result.cart);
    setChanges(result.changes);
    return { ...result, ready: true };
  }, []);

  const hydrateListingForCheckout = useCallback((listingKey, quantity = 1) => {
    const listings = liveListingsRef.current;
    if (!navigator.onLine || !catalogAuthoritativeRef.current || !Array.isArray(listings)) {
      return {
        eligible: false,
        reason: navigator.onLine
          ? "Live marketplace availability is still loading. Please try again."
          : "Reconnect to the internet before checkout.",
      };
    }
    const listingsByKey = new Map();
    for (const listing of listings) {
      const key = getCanonicalListingKey(listing);
      if (key) listingsByKey.set(key, listing);
    }
    return resolveCheckoutListing({
      listingKey,
      quantity,
      listingsByKey,
      authoritativeKeys: authoritativeKeysRef.current,
    });
  }, []);

  // NOTE: the vacation lookup above calls `revalidateRef.current?.()`. That ref is
  // declared just below with the mount/focus handlers — deliberately reused rather
  // than adding a second one, so there is only ever one "latest revalidate" holder.

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
        setConflict({ ...result.conflict, type: "seller_add" });
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
    setCart((current) => ({
      ...replaceCartModel(listing, quantity),
      serverRevision: current.serverRevision,
    }));
  }, []);

  const resolveConflict = useCallback(async (choice) => {
    const pending = conflict;
    if (!pending) return;

    if (pending.type === "sync_conflict") {
      const result = await resolveCartRevisionConflict({
        account,
        conflict: pending,
        resolution: choice,
        canSync,
      });
      if (!result.ok) {
        setConflict(result.conflict || { ...pending, error: result.error });
        return;
      }
      skipNextSaveRef.current = true;
      setConflict(null);
      setCart(result.cart);
      return;
    }

    if (pending.type === "account_merge") {
      const result = await resolveCartMerge({
        account,
        conflict: pending,
        resolution: choice,
        canSync,
      });
      if (!result.ok) {
        if (result.code === "operation_mismatch") {
          setConflict({
            type: "merge_error",
            code: result.code,
            error: result.error,
            accountCart: pending.accountCart,
            guestCart: pending.guestCart,
          });
        } else if (result.conflict) {
          setConflict(result.conflict);
        } else {
          setConflict((current) => current ? { ...current, error: result.error } : current);
        }
        return;
      }
      skipNextSaveRef.current = true;
      setConflict(null);
      setCart(result.cart);
      return;
    }

    setConflict(null);
    if (!choice) return;
    // conflict.incomingItem is already a fully-formed CartItem (built by
    // cartModel's addToCart via cartItemFromListing) — replace the cart with
    // it directly rather than routing back through replaceCart, which
    // expects a raw listing shape.
    setCart((current) => ({
      seller: pending.incomingSeller,
      items: [pending.incomingItem],
      updatedAt: Date.now(),
      serverRevision: current.serverRevision,
    }));
  }, [account, canSync, conflict]);

  const dismissConflict = useCallback(() => setConflict(null), []);

  const clear = useCallback(() => {
    setCart((current) => ({ ...emptyCart(), serverRevision: current.serverRevision }));
  }, []);

  const totals = cartTotals(cart);

  const value = {
    cart,
    loaded,
    totals,
    changes,
    conflict,
    catalogAuthoritative,
    catalogRevision,
    authoritativeListingKeys,
    hydrateListingForCheckout,
    addItem,
    setItemQuantity,
    removeItem,
    replaceCart: replaceCartWith,
    resolveConflict,
    retryMerge,
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
