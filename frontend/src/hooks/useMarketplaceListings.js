import { useQuery } from "@tanstack/react-query";
import { db } from "../db";
import { fetchListingsByBreed } from "../utils/listingManager";
import { getProvider } from "../utils/smartAccount";
import { getLocalListings } from "../services/relayer";

export function useMarketplaceListings(contractAddress, marketplaceAddress, filterSpeciesId = null) {
  return useQuery({
    queryKey: ["listings", filterSpeciesId || "all"],
    queryFn: async () => {
      const provider = getProvider();
      // Local-first beta listings (created without MetaMask)
      const localListings = await getLocalListings(filterSpeciesId);
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

        // Merge local beta listings (deduplicated by id)
        const ids = new Set(data.map((l) => Number(l.id)));
        return [...data, ...localListings.filter((l) => !ids.has(Number(l.id)))];
      } catch (err) {
        console.warn("Fetch listings failed, reading from Dexie offline database...", err);
        const cached = await db.listings.toArray();
        const ids = new Set(localListings.map((l) => Number(l.id)));
        const base = (cached || []).filter((item) =>
          filterSpeciesId ? Number(item.speciesId) === Number(filterSpeciesId) : true
        );
        const merged = [...base.filter((l) => !ids.has(Number(l.id))), ...localListings];
        if (merged.length > 0) {
          return merged;
        }
        throw err;
      }
    },
    staleTime: 1000 * 60 * 2, // 2 minutes (invalidated reactively on-chain)
    gcTime: 1000 * 60 * 30, // 30 minutes
    enabled: !!contractAddress && !!marketplaceAddress,
  });
}
