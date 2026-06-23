/**
 * useStorefront.js — TanStack Query hook for fetching complete storefront data.
 *
 * Returns the full storefront payload: breeder profile, stats, active listings,
 * and breeding history. Supports offline fallback via Dexie cache.
 *
 * Follows the same pattern as useMarketplaceListings.js.
 */

import { useQuery } from "@tanstack/react-query";
import { db } from "../db";
import {
  fetchBreederProfile,
  fetchBreederListings,
  fetchBreederStats,
  fetchBreedingHistory,
} from "../services/breederRegistry";

/**
 * @param {string} identifier - Wallet address or slug
 * @param {{ enabled?: boolean }} options
 */
export function useStorefront(identifier, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["storefront", identifier],
    queryFn: async () => {
      if (!identifier) throw new Error("No storefront identifier provided");

      // Fetch profile first to get the canonical wallet address
      const profile = await fetchBreederProfile(identifier);
      if (!profile) {
        throw new Error("Breeder not found");
      }

      const wallet = profile.walletAddress;

      // Parallel fetch: listings, stats, breeding history
      const [listings, stats, breedingHistory] = await Promise.all([
        fetchBreederListings(wallet),
        fetchBreederStats(wallet),
        fetchBreedingHistory(wallet),
      ]);

      const storefront = {
        profile,
        stats,
        listings,
        breedingHistory,
        fetchedAt: Date.now(),
      };

      // Cache in Dexie for offline access
      try {
        await db.storefrontCache.put({
          id: identifier.toLowerCase(),
          walletAddress: wallet,
          data: storefront,
          cachedAt: Date.now(),
        });
      } catch (cacheErr) {
        console.warn("[useStorefront] Dexie cache write failed:", cacheErr);
      }

      return storefront;
    },
    staleTime: 1000 * 60 * 3, // 3 minutes
    gcTime: 1000 * 60 * 30,   // 30 minutes
    enabled: enabled && !!identifier,
    retry: 1,
    // Offline fallback: use Dexie cached data as placeholder
    placeholderData: () => {
      // This is synchronous so we can't await Dexie here.
      // Instead we handle it in the component via a separate effect.
      return undefined;
    },
  });
}

/**
 * Hook to get cached storefront data from Dexie (offline fallback).
 * Call this when the main query errors or when offline.
 */
export function useStorefrontCache(identifier) {
  return useQuery({
    queryKey: ["storefront-cache", identifier],
    queryFn: async () => {
      if (!identifier) return null;
      const cached = await db.storefrontCache.get(identifier.toLowerCase());
      return cached?.data || null;
    },
    enabled: !!identifier,
    staleTime: Infinity, // Cache never goes stale (it's a fallback)
  });
}

/**
 * Hook for the discovery endpoint (browse all storefronts).
 */
export function useStorefrontDiscovery({ limit = 20, offset = 0, search = "" } = {}) {
  return useQuery({
    queryKey: ["storefront-discover", limit, offset, search],
    queryFn: async () => {
      const { discoverStorefronts } = await import("../services/breederRegistry");
      return discoverStorefronts({ limit, offset, search });
    },
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 15,
  });
}
