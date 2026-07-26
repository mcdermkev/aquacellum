import { useMemo } from "react";
import { useMarketplaceListings } from "./useMarketplaceListings";
import { buildSpeciesAvailability, getAvailabilityFor } from "../services/speciesAvailability";

/**
 * useSpeciesAvailability — in-app per-species marketplace availability for Fish
 * Finder (Fish Finder Rework, Task 3).
 *
 * Composes the existing `useMarketplaceListings` query (same ["listings","all"]
 * queryKey, so this shares the cache with the Marketplace board — no extra
 * fetch) with the pure `buildSpeciesAvailability` projection. Returns the index
 * plus a bound `getAvailability(entry)` helper the cards/detail call to render
 * "Available from N sellers · from $X" and route to listings.
 *
 * @param {string} contractAddress
 * @param {string} marketplaceAddress
 * @returns {{
 *   index: {bySpeciesId:Map, byScientificName:Map},
 *   getAvailability: (entry:{speciesId?:number,scientificName?:string}) => (Object|null),
 *   isLoading: boolean,
 *   error: (Error|null)
 * }}
 */
export function useSpeciesAvailability(contractAddress, marketplaceAddress) {
  const { data: listings = [], isLoading, error } = useMarketplaceListings(
    contractAddress,
    marketplaceAddress,
    null // all species — one index for the whole catalog view
  );

  const index = useMemo(() => buildSpeciesAvailability(listings), [listings]);

  const getAvailability = useMemo(
    () => (entry) => getAvailabilityFor(index, entry),
    [index]
  );

  return { index, getAvailability, isLoading, error };
}
