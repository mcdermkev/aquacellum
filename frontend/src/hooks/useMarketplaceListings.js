import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "../db";
import { fetchListingsByBreed } from "../utils/listingManager";
import { getProvider } from "../utils/smartAccount";
import { getLocalListings } from "../services/relayer";
import { pullCloudListings } from "../services/cloudSync";
import { getCanonicalListingKey } from "../services/catalogQuery";

function markCatalogMetadata(listings, source, authoritativeKeys = []) {
  const result = Array.isArray(listings) ? listings : [];
  Object.defineProperties(result, {
    __catalogSource: {
      value: source,
      enumerable: true,
      configurable: true,
    },
    __authoritativeKeys: {
      value: [...new Set(authoritativeKeys)],
      enumerable: true,
      configurable: true,
    },
  });
  return result;
}

function mergeByCanonicalKey(...groups) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const listing of Array.isArray(group) ? group : []) {
      const key = getCanonicalListingKey(listing);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(listing);
    }
  }
  return merged;
}

export function useMarketplaceListings(contractAddress, marketplaceAddress, filterSpeciesId = null) {
  const query = useQuery({
    queryKey: ["listings", filterSpeciesId || "all"],
    queryFn: async () => {
      const provider = getProvider();
      // Local-first beta listings (created without MetaMask)
      const localListings = await getLocalListings(filterSpeciesId);

      // Cloud listings from all users (Supabase — cross-user visibility)
      const cloudListings = await pullCloudListings(filterSpeciesId);

      try {
        const onChainListings = await fetchListingsByBreed(
          filterSpeciesId,
          contractAddress,
          marketplaceAddress,
          provider
        );

        // Update Dexie database offline cache if fetching all listings.
        if (!filterSpeciesId) {
          try {
            await db.listings.clear();
            await db.listings.bulkAdd(onChainListings);
          } catch (dbErr) {
            console.warn("Failed to store listings in Dexie cache:", dbErr);
          }
        }

        // Merge by the type-prefixed canonical identity. On-chain and current
        // server-backed cloud rows are authoritative for their own keys only;
        // a successful chain read never promotes unrelated device-local rows.
        const merged = mergeByCanonicalKey(onChainListings, cloudListings, localListings);
        const authoritativeKeys = [...onChainListings, ...cloudListings]
          .map(getCanonicalListingKey)
          .filter(Boolean);
        return markCatalogMetadata(merged, "authoritative", authoritativeKeys);
      } catch (err) {
        console.warn("Fetch listings failed, using cloud + local fallback...", err);

        const cached = await db.listings.toArray();
        const matchingCache = (cached || []).filter((item) =>
          filterSpeciesId ? Number(item.speciesId) === Number(filterSpeciesId) : true
        );

        // Fallback rows remain useful for discovery but authorize no checkout.
        const merged = mergeByCanonicalKey(cloudListings, matchingCache, localListings);
        if (merged.length > 0) return markCatalogMetadata(merged, "fallback", []);
        throw err;
      }
    },
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 30,
    enabled: !!contractAddress && !!marketplaceAddress,
  });

  const authoritativeListingKeys = useMemo(
    () => new Set(query.data?.__authoritativeKeys || []),
    [query.data],
  );

  return {
    ...query,
    isAuthoritative: query.data?.__catalogSource === "authoritative",
    catalogSource: query.data?.__catalogSource || (query.isError ? "error" : "loading"),
    authoritativeListingKeys,
    catalogRevision: query.dataUpdatedAt || 0,
  };
}
