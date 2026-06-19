import { useQuery } from "@tanstack/react-query";
import { db } from "../db";
import { fetchListingsByBreed } from "../utils/listingManager";
import { getProvider } from "../utils/smartAccount";
import { getLocalListings } from "../services/relayer";
import { pullCloudListings } from "../services/cloudSync";

export function useMarketplaceListings(contractAddress, marketplaceAddress, filterSpeciesId = null) {
  return useQuery({
    queryKey: ["listings", filterSpeciesId || "all"],
    queryFn: async () => {
      const provider = getProvider();
      // Local-first beta listings (created without MetaMask)
      const localListings = await getLocalListings(filterSpeciesId);

      // Cloud listings from all users (Supabase — cross-user visibility)
      const cloudListings = await pullCloudListings(filterSpeciesId);

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

        // Merge: on-chain > cloud > local (deduplicated by id)
        const ids = new Set(data.map((l) => Number(l.id)));
        const uniqueCloud = cloudListings.filter((l) => !ids.has(Number(l.id)));
        uniqueCloud.forEach((l) => ids.add(Number(l.id)));
        const uniqueLocal = localListings.filter((l) => !ids.has(Number(l.id)));

        return [...data, ...uniqueCloud, ...uniqueLocal];
      } catch (err) {
        console.warn("Fetch listings failed, using cloud + local fallback...", err);

        // Fallback: merge cloud listings + local listings + Dexie cache
        const cached = await db.listings.toArray();
        const base = (cached || []).filter((item) =>
          filterSpeciesId ? Number(item.speciesId) === Number(filterSpeciesId) : true
        );

        // Deduplicate: cloud > cached > local
        const ids = new Set();
        const merged = [];
        for (const l of cloudListings) { ids.add(Number(l.id)); merged.push(l); }
        for (const l of base) { if (!ids.has(Number(l.id))) { ids.add(Number(l.id)); merged.push(l); } }
        for (const l of localListings) { if (!ids.has(Number(l.id))) { ids.add(Number(l.id)); merged.push(l); } }

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
