import { useQuery } from "@tanstack/react-query";
import { Contract } from "ethers";
import { db } from "../db";
import aquadexAbi from "../abi/AquadexManager.json";
import { getProvider } from "../utils/smartAccount";

export function useUserTanks(contractAddress, walletAccount) {
  return useQuery({
    queryKey: ["tanks", walletAccount],
    queryFn: async () => {
      // Beta: Read from Dexie first (local-first approach)
      // Tanks are stored locally via relayer.js during beta
      const localTanks = await db.tanks.where("ownerAddress").equals(walletAccount).toArray();

      // Also try on-chain for any historically registered tanks
      let onChainTanks = [];
      try {
        const provider = getProvider();
        const contract = new Contract(contractAddress, aquadexAbi, provider);

        const tankIds = [];
        let index = 0;
        while (true) {
          try {
            const id = await contract.ownerTanks(walletAccount, index);
            tankIds.push(Number(id));
            index++;
          } catch (e) {
            break;
          }
        }

        if (tankIds.length > 0) {
          onChainTanks = await Promise.all(
            tankIds.map(async (id) => {
              const tankData = await contract.tanks(id);

              const logs = [];
              let logIndex = 0;
              while (true) {
                try {
                  const log = await contract.tankParameterLogs(id, logIndex);
                  logs.push({
                    timestamp: Number(log.timestamp),
                    tempCelsiusX10: Number(log.tempCelsiusX10),
                    phX10: Number(log.phX10),
                    salinitySgX10000: Number(log.salinitySgX10000),
                    ammoniaPpmX100: Number(log.ammoniaPpmX100),
                    nitritePpmX100: Number(log.nitritePpmX100),
                    nitratePpmX100: Number(log.nitratePpmX100),
                    notes: log.notes
                  });
                  logIndex++;
                } catch (e) {
                  break;
                }
              }

              const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;

              const specimens = [];
              let specIdx = 0;
              while (true) {
                try {
                  const specId = await contract.tankSpecimenIds(id, specIdx);
                  const sId = Number(specId);
                  const specData = await contract.specimens(sId);
                  const speciesId = Number(specData.speciesId);

                  let commonName = `Species ID ${speciesId}`;
                  let scientificName = "Unknown";
                  try {
                    const speciesInfo = await contract.speciesCatalog(speciesId);
                    commonName = speciesInfo.commonName || commonName;
                    scientificName = speciesInfo.scientificName || scientificName;
                  } catch (e) {}

                  specimens.push({
                    id: sId,
                    speciesId,
                    commonName,
                    scientificName,
                    status: Number(specData.status)
                  });
                  specIdx++;
                } catch (err) {
                  break;
                }
              }

              return {
                id,
                ownerAddress: walletAccount,
                name: tankData.name,
                tankType: Number(tankData.tankType),
                volumeLiters: Number(tankData.volumeLiters),
                creationTimestamp: Number(tankData.creationTimestamp),
                active: tankData.active,
                containment: Number(tankData.containment),
                parentUnitId: Number(tankData.parentUnitId),
                facility: tankData.facility || "Main Room",
                room: tankData.room || "",
                rack: tankData.rack || "",
                logs,
                latestLog,
                specimens
              };
            })
          );

          onChainTanks = onChainTanks.filter((t) => t.active);
        }
      } catch (err) {
        console.warn("On-chain tank query failed (expected for Privy-only users):", err.message);
      }

      // Merge: local tanks + on-chain tanks (deduplicate by id)
      const allTanks = [...localTanks];
      for (const oct of onChainTanks) {
        if (!allTanks.some((t) => t.id === oct.id)) {
          allTanks.push(oct);
        }
      }

      return allTanks;
    },
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 30,
    enabled: !!contractAddress && !!walletAccount,
  });
}
