import { useQuery } from "@tanstack/react-query";
import { Contract } from "ethers";
import { db } from "../db";
import aquadexAbi from "../abi/AquadexManager.json";
import { getProvider } from "../utils/smartAccount";

// Hook to load static fishbase reference catalog (supports offline Dexie fallback)
export function useSpeciesData() {
  return useQuery({
    queryKey: ["species"],
    queryFn: async () => {
      try {
        const res = await fetch("/fishbase_master.json");
        if (!res.ok) throw new Error("Failed to load reference library");
        const rawData = await res.json();

        // Enrich reference data with safe fallbacks for missing rich fields
        const data = rawData.map(item => ({
          ...item,
          family: item.family || "Information arriving soon",
          ecology: {
            comments: item.ecology?.comments || "Information arriving soon",
            biotope: item.ecology?.biotope || "Generic Biotope Details",
            phMin: item.ecology?.phMin ?? item.tankMetrics?.phRange?.[0] ?? 6.5,
            phMax: item.ecology?.phMax ?? item.tankMetrics?.phRange?.[1] ?? 7.5,
            hardnessRange: item.ecology?.hardnessRange || "5 - 15 dGH",
            tempCeiling: item.ecology?.tempCeiling ?? item.tankMetrics?.tempRangeCelsius?.[1] ?? 28,
            socialBehavior: item.ecology?.socialBehavior || "Information arriving soon",
          },
          diet: {
            trophicLevel: item.diet?.trophicLevel || "Omnivore",
            fooditems: item.diet?.fooditems || "Information arriving soon",
            feedingPlaybook: item.diet?.feedingPlaybook || "Information arriving soon",
          },
          reproduction: {
            spawningTrait: item.reproduction?.spawningTrait || "Information arriving soon",
            layoutRequirement: item.reproduction?.layoutRequirement || "Information arriving soon",
            comments: item.reproduction?.comments || "Information arriving soon",
          }
        }));

        // Update Dexie database offline cache
        try {
          await db.species.clear();
          await db.species.bulkAdd(data);
        } catch (dbErr) {
          console.warn("Failed to store species in Dexie cache:", dbErr);
        }

        return data;
      } catch (err) {
        console.warn("Fetch species catalog failed, reading from Dexie offline database...", err);
        const cached = await db.species.toArray();
        if (cached && cached.length > 0) {
          return cached;
        }
        throw err;
      }
    },
    staleTime: Infinity, // Reference library is fully static and never changes
    gcTime: Infinity,
  });
}

// Hook to load active registered breeds from the smart contract catalog
// Uses stale-while-revalidate: shows Dexie cache immediately, refreshes from chain in background
export function useContractSpecies(contractAddress) {
  // First, serve from Dexie cache for instant load
  const cachedQuery = useQuery({
    queryKey: ["contractSpeciesCache", contractAddress],
    queryFn: async () => {
      const cached = await db.speciesManifest
        .where("contractAddress")
        .equals(contractAddress)
        .toArray();
      if (cached && cached.length > 0) return cached;
      return null;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: !!contractAddress,
  });

  // Then fetch live data from the contract (runs in parallel)
  const liveQuery = useQuery({
    queryKey: ["contractSpeciesLive", contractAddress],
    queryFn: async () => {
      const provider = getProvider();
      const contract = new Contract(contractAddress, aquadexAbi, provider);

      const nextId = await contract.nextSpeciesId();
      const totalCount = Number(nextId) - 1;
      if (totalCount <= 0) return [];

      // Fetch all species data in parallel (batched to avoid rate limits)
      const BATCH_SIZE = 10;
      const allResults = [];

      for (let batchStart = 1; batchStart <= totalCount; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalCount);
        const batchPromises = [];

        for (let i = batchStart; i <= batchEnd; i++) {
          batchPromises.push(
            Promise.all([
              contract.speciesCatalog(i),
              contract.getSpecimensCountByBreed(i),
            ]).then(([species, count]) => ({ id: i, species, count }))
          );
        }

        const batchResults = await Promise.all(batchPromises);
        allResults.push(...batchResults);
      }

      // Process results
      const catalog = [];
      const seenNames = new Set();

      for (const { id, species, count } of allResults) {
        if (species.active) {
          const nameLower = species.scientificName.toLowerCase();

          if (seenNames.has(nameLower)) {
            const existing = catalog.find(item => item.scientificName.toLowerCase() === nameLower);
            if (existing) {
              existing.specimenCount += Number(count);
              if (!existing.allSpeciesIds) {
                existing.allSpeciesIds = [existing.speciesId];
              }
              existing.allSpeciesIds.push(id);
            }
            continue;
          }
          seenNames.add(nameLower);

          catalog.push({
            speciesId: id,
            allSpeciesIds: [id],
            scientificName: species.scientificName,
            commonName: species.commonName,
            canonicalIpfsUri: species.canonicalIpfsUri,
            careLevel: Number(species.careLevel),
            minTemp: Number(species.minTempCelsiusX10) / 10,
            maxTemp: Number(species.maxTempCelsiusX10) / 10,
            minPh: Number(species.minPhX10) / 10,
            maxPh: Number(species.maxPhX10) / 10,
            specimenCount: Number(count),
          });
        }
      }

      // Persist to Dexie speciesManifest for next instant load
      try {
        const cachedAt = Date.now();
        const manifests = catalog.map(entry => ({
          ...entry,
          contractAddress,
          cachedAt
        }));
        await db.speciesManifest
          .where("contractAddress")
          .equals(contractAddress)
          .delete();
        await db.speciesManifest.bulkAdd(manifests);
      } catch (dbErr) {
        console.warn("Failed to persist species manifest to Dexie cache:", dbErr);
      }

      return catalog;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
    enabled: !!contractAddress,
    retry: 1,
  });

  // Return live data if available, otherwise cached data, otherwise loading state
  const data = liveQuery.data ?? cachedQuery.data ?? [];
  const isLoading = (cachedQuery.isLoading && liveQuery.isLoading) || 
                    (data.length === 0 && liveQuery.isLoading);
  const error = liveQuery.error && !cachedQuery.data ? liveQuery.error : null;

  return {
    data,
    isLoading,
    error,
    refetch: liveQuery.refetch,
  };
}
