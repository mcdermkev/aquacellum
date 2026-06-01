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
export function useContractSpecies(contractAddress) {
  return useQuery({
    queryKey: ["contractSpecies", contractAddress],
    queryFn: async () => {
      const provider = getProvider();
      const contract = new Contract(contractAddress, aquadexAbi, provider);

      try {
        const nextId = await contract.nextSpeciesId();
        const catalog = [];
        const seenNames = new Set();

        for (let i = 1; i < Number(nextId); i++) {
          const species = await contract.speciesCatalog(i);
          if (species.active) {
            const nameLower = species.scientificName.toLowerCase();
            const count = await contract.getSpecimensCountByBreed(i);

            if (seenNames.has(nameLower)) {
              const existing = catalog.find(item => item.scientificName.toLowerCase() === nameLower);
              if (existing) {
                existing.specimenCount += Number(count);
                if (!existing.allSpeciesIds) {
                  existing.allSpeciesIds = [existing.speciesId];
                }
                existing.allSpeciesIds.push(i);
              }
              continue;
            }
            seenNames.add(nameLower);

            catalog.push({
              speciesId: i,
              allSpeciesIds: [i],
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

        // Persist to Dexie speciesManifest for offline-first reads
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
      } catch (err) {
        // Offline fallback: read species manifest from Dexie local cache
        console.warn("Contract species fetch failed, reading from Dexie species manifest...", err);
        const cached = await db.speciesManifest
          .where("contractAddress")
          .equals(contractAddress)
          .toArray();
        if (cached && cached.length > 0) {
          return cached;
        }
        throw err;
      }
    },
    staleTime: 1000 * 60, // 60 seconds
    gcTime: 1000 * 60 * 15, // 15 minutes
    enabled: !!contractAddress,
  });
}
