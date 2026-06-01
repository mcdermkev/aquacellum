import { useQuery } from "@tanstack/react-query";
import { Contract } from "ethers";
import { db } from "../db";
import aquadexAbi from "../abi/AquadexManager.json";
import { getProvider } from "../utils/smartAccount";

export function useUserTanks(contractAddress, walletAccount) {
  return useQuery({
    queryKey: ["tanks", walletAccount],
    queryFn: async () => {
      const provider = getProvider();
      const contract = new Contract(contractAddress, aquadexAbi, provider);

      try {
        // 1. Get all tank IDs owned by wallet
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

        // 2. Fetch tank details, parameters logs, and specimen list in parallel
        const tankDetails = await Promise.all(
          tankIds.map(async (id) => {
            const tankData = await contract.tanks(id);

            // Fetch all parameters logs
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

            // Fetch specimens inside
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
              room: tankData.room || "Garage Rack",
              rack: tankData.rack || "Outdoor Ponds",
              logs,
              latestLog,
              specimens
            };
          })
        );

        const activeTanks = tankDetails.filter((t) => t.active);

        // Update Dexie database offline cache
        try {
          await db.tanks.where("ownerAddress").equals(walletAccount).delete();
          await db.tanks.bulkAdd(activeTanks);
        } catch (dbErr) {
          console.warn("Failed to store tanks in Dexie cache:", dbErr);
        }

        return activeTanks;
      } catch (err) {
        console.warn("Fetch dashboard data failed, reading from Dexie offline database...", err);
        const cached = await db.tanks.where("ownerAddress").equals(walletAccount).toArray();
        if (cached && cached.length > 0) {
          return cached;
        }
        throw err;
      }
    },
    staleTime: 1000 * 60 * 2, // 2 minutes (invalidated reactively on-chain)
    gcTime: 1000 * 60 * 30, // 30 minutes
    enabled: !!contractAddress && !!walletAccount,
  });
}
