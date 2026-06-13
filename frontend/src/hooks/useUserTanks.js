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

      // Populate latest test and change timestamps from actionLogs and parameter logs
      for (const tank of allTanks) {
        try {
          // Retrieve action logs for this tank (handling type mismatch safely)
          const actionLogs = await db.actionLogs
            .where("tankId")
            .anyOf([tank.id, tank.id.toString(), Number(tank.id)])
            .toArray();
          
          // Latest Water Test can come from actionLogs OR tank.logs (parameter logs)
          let latestTest = null;

          // 1. Check actionLogs for tests
          const testActionLogs = actionLogs.filter(
            (l) => l.actionType === "Quick Water Test" || l.actionType === "Water Test" || l.actionType === "Detailed Test"
          );
          if (testActionLogs.length > 0) {
            testActionLogs.sort((a, b) => b.timestamp - a.timestamp);
            latestTest = testActionLogs[0].timestamp;
          }

          // 2. Check tank.logs (parameter logs) for tests
          const parameterLogs = tank.logs || [];
          if (parameterLogs.length > 0) {
            const sortedParams = [...parameterLogs].sort((a, b) => b.timestamp - a.timestamp);
            const latestParamTime = sortedParams[0].timestamp;
            if (!latestTest || latestParamTime > latestTest) {
              latestTest = latestParamTime;
            }
          }

          // 3. Fallback to tank.latestLog
          if (tank.latestLog && (!latestTest || tank.latestLog.timestamp > latestTest)) {
            latestTest = tank.latestLog.timestamp;
          }

          // Latest Water Change can come from actionLogs OR tank.logs (where notes/details mention change)
          let latestChange = null;

          // 1. Check actionLogs for changes
          const changeActionLogs = actionLogs.filter(
            (l) => l.actionType === "Water Change" || l.actionType === "Log Immediate Water Change" || (l.details && typeof l.details === "string" && l.details.toLowerCase().includes("water change"))
          );
          if (changeActionLogs.length > 0) {
            changeActionLogs.sort((a, b) => b.timestamp - a.timestamp);
            latestChange = changeActionLogs[0].timestamp;
          }

          // 2. Check tank.logs (parameter logs) for notes containing "change" or "water change"
          const waterChangeParams = parameterLogs.filter(
            (l) => l.notes && typeof l.notes === "string" && (l.notes.toLowerCase().includes("water change") || l.notes.toLowerCase().includes("waterchange") || l.notes.toLowerCase().includes("changed"))
          );
          if (waterChangeParams.length > 0) {
            waterChangeParams.sort((a, b) => b.timestamp - a.timestamp);
            const latestParamChangeTime = waterChangeParams[0].timestamp;
            if (!latestChange || latestParamChangeTime > latestChange) {
              latestChange = latestParamChangeTime;
            }
          }

          // 3. Check tank.latestLog notes
          if (tank.latestLog && tank.latestLog.notes && typeof tank.latestLog.notes === "string") {
            const notes = tank.latestLog.notes.toLowerCase();
            if (notes.includes("water change") || notes.includes("waterchange") || notes.includes("changed")) {
              if (!latestChange || tank.latestLog.timestamp > latestChange) {
                latestChange = tank.latestLog.timestamp;
              }
            }
          }
          
          tank.latestTestTimestamp = latestTest;
          tank.latestChangeTimestamp = latestChange;
        } catch (e) {
          console.warn("Failed to populate latest timestamps for tank:", tank.id, e);
        }
      }

      return allTanks;
    },
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 30,
    enabled: !!contractAddress && !!walletAccount,
  });
}
