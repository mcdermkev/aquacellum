import { useQuery } from "@tanstack/react-query";
import { db } from "../db";
import { fetchListingsByBreed } from "../utils/listingManager";
import { getProvider } from "../utils/smartAccount";

export function useMarketplaceListings(contractAddress, marketplaceAddress, filterSpeciesId = null) {
  return useQuery({
    queryKey: ["listings", filterSpeciesId || "all"],
    queryFn: async () => {
      const provider = getProvider();
      try {
        const data = await fetchListingsByBreed(
          filterSpeciesId,
          contractAddress,
          marketplaceAddress,
          provider
        );

        // Update Dexie database offline cache if fetching all listings
        if (!filterSpeciesId) {
          try {
            await db.listings.clear();
            await db.listings.bulkAdd(data);
          } catch (dbErr) {
            console.warn("Failed to store listings in Dexie cache:", dbErr);
          }
        }

        return data;
      } catch (err) {
        console.warn("Fetch listings failed, reading from Dexie offline database...", err);
        const cached = await db.listings.toArray();
        if (cached && cached.length > 0) {
          if (filterSpeciesId) {
            return cached.filter(item => Number(item.speciesId) === Number(filterSpeciesId));
          }
          return cached;
        }
        throw err;
      }
    },
    staleTime: 1000 * 60 * 2, // 2 minutes (invalidated reactively on-chain)
    gcTime: 1000 * 60 * 30, // 30 minutes
    enabled: !!contractAddress && !!marketplaceAddress,
  });
}
