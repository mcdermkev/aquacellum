import { useEffect, useState, useCallback } from "react";
import {
  getDexEntries,
  reconcileDexFromTanks,
  getWishlist,
  toggleWishlist as toggleWishlistEntry,
} from "../services/dexService.js";

/**
 * useDex — React binding for "My Dex" + wishlist (Fish Finder Rework Task 9).
 *
 * Owns no business logic itself — every read/write composes dexService.js.
 * Reconciles the Dex against the keeper's real tanks once per (walletAddress,
 * tanks-loaded) transition, then exposes the Dex + wishlist as plain arrays
 * plus a wishlist toggle for cards to call.
 *
 * @param {string} walletAddress
 * @param {Array} tanks - from useUserTanks (pass [] while loading; the hook
 *   waits for tanksLoaded before reconciling so it never race-adds against a
 *   still-empty tank list)
 * @param {boolean} tanksLoaded - true once useUserTanks has resolved at least
 *   once (its `!isLoading`), so reconciliation runs against real data
 */
export function useDex(walletAddress, tanks, tanksLoaded) {
  const [dexEntries, setDexEntries] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [loading, setLoading] = useState(true);
  // The species that were ACTUALLY added (and therefore actually awarded XP) by
  // the last reconcile — the only honest source for a "+N pts" reward toast.
  // Consumers must not infer this by diffing `dexEntries`: loading a returning
  // keeper's existing Dex would look like a fresh batch of discoveries and
  // announce XP that was never granted.
  const [lastAdded, setLastAdded] = useState([]);

  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setDexEntries([]);
      setWishlist([]);
      setLoading(false);
      return;
    }
    const [entries, wl] = await Promise.all([getDexEntries(walletAddress), getWishlist(walletAddress)]);
    setDexEntries(entries);
    setWishlist(wl);
    setLoading(false);
  }, [walletAddress]);

  // Initial + wallet-change load.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Reconcile once tanks have actually loaded (real data, not the empty
  // default array useUserTanks starts with while its query is pending).
  useEffect(() => {
    if (!walletAddress || !tanksLoaded) return;
    (async () => {
      const added = await reconcileDexFromTanks(walletAddress, tanks);
      if (added.length > 0) {
        await refresh();
        setLastAdded(added);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, tanksLoaded, tanks]);

  const wishlistKeys = new Set(wishlist.map((w) => w.speciesKey));
  const isWishlisted = useCallback(
    (scientificName) => wishlistKeys.has(String(scientificName || "").trim().toLowerCase()),
    [wishlist] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const toggleWishlist = useCallback(async (entry) => {
    if (!walletAddress) return false;
    const result = await toggleWishlistEntry(walletAddress, entry);
    await refresh();
    return result;
  }, [walletAddress, refresh]);

  const dexKeys = new Set(dexEntries.map((e) => e.speciesKey));
  const isKept = useCallback(
    (scientificName) => dexKeys.has(String(scientificName || "").trim().toLowerCase()),
    [dexEntries] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return { dexEntries, wishlist, loading, lastAdded, isWishlisted, toggleWishlist, isKept, refresh };
}
