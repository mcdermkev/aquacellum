import { useQuery } from "@tanstack/react-query";
import { Contract } from "ethers";
import { db } from "../db";
import aquadexAbi from "../abi/AquadexManager.json";
import { getProvider } from "../utils/smartAccount";

export function useUserTanks(contractAddress, walletAccount) {
  return useQuery({
    queryKey: ["tanks", walletAccount],
    queryFn: async () => {
      // CANONICAL ADDRESS RULE (see relayer.js): every ownerAddress written to
      // Dexie is lowercased. Privy hands us a checksummed (mixed-case) address,
      // and Dexie's .equals() is case-sensitive — so we MUST lowercase before
      // querying or every lookup returns 0 rows ("0 Units Found").
      const owner = (walletAccount || "").toLowerCase();

      // Beta: Read from Dexie first (local-first approach)
      // Tanks are stored locally via relayer.js during beta
      const localTanks = (await db.tanks.where("ownerAddress").equals(owner).toArray())
        .filter(t => t.active !== false);

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
                ownerAddress: owner,
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

      // Reconcile: ensure specimens from the standalone db.specimens table
      // are also reflected in their tank's specimens array (fixes spawned fish
      // not appearing in tanks when they were minted against an on-chain tank ID).
      try {
        const allLocalSpecimens = await db.specimens
          .where("ownerAddress").equals(owner)
          .filter(s => Number(s.status) === 0 && s.currentTankId && Number(s.currentTankId) !== 0)
          .toArray();

        for (const spec of allLocalSpecimens) {
          const tankId = Number(spec.currentTankId);
          const tank = allTanks.find(t => Number(t.id) === tankId);
          if (tank) {
            const existingSpecimens = tank.specimens || [];
            if (!existingSpecimens.some(s => Number(s.id) === Number(spec.id))) {
              existingSpecimens.push({
                id: Number(spec.id),
                speciesId: Number(spec.speciesId),
                commonName: spec.commonName || "",
                scientificName: spec.scientificName || "",
                status: 0,
                gender: spec.gender || "Unsexed",
                sireId: Number(spec.sireId || 0),
                damId: Number(spec.damId || 0),
              });
              tank.specimens = existingSpecimens;
            }
          }
        }
      } catch (reconcileErr) {
        console.warn("Specimen reconciliation failed:", reconcileErr);
      }

      // Arrival Flow: Include batch orders assigned to each tank as synthetic entries.
      // Shows "X juvenile fry — pending individual registration" in the tank view.
      try {
        const batchOrders = await db.marketOrders
          .where("assignedTankId")
          .above(0)
          .toArray();
        for (const order of batchOrders) {
          const tankId = Number(order.assignedTankId);
          const tank = allTanks.find(t => Number(t.id) === tankId);
          if (tank) {
            const existingSpecimens = tank.specimens || [];
            const batchKey = `batch-${order.purchaseId || order.key}`;
            if (!existingSpecimens.some(s => s.id === batchKey)) {
              existingSpecimens.push({
                id: batchKey,
                isBatchPlaceholder: true,
                quantity: order.quantity || 0,
                commonName: order.commonName || "Juvenile Fry",
                speciesId: 0,
                status: 0,
              });
              tank.specimens = existingSpecimens;
            }
          }
        }
      } catch (batchErr) {
        console.warn("Batch arrival reconciliation failed:", batchErr);
      }

      // Populate latest test and change timestamps from actionLogs and parameter logs
      for (const tank of allTanks) {
        try {
          // Structured sources only — no more scanning free-text notes/details for
          // the word "water change" (Logbook Rework Task 1). Latest test/change
          // are derived from: typed actionLogs, the paramReadings table, and the
          // on-chain parameter logs (tank.logs / tank.latestLog).
          const tankIdKeys = [tank.id, tank.id.toString(), Number(tank.id)];
          const actionLogs = await db.actionLogs.where("tankId").anyOf(tankIdKeys).toArray();

          let paramReadings = [];
          try {
            paramReadings = await db.paramReadings.where("tankId").anyOf(tankIdKeys).toArray();
          } catch { /* table absent pre-migration — ignore */ }

          const maxTs = (arr, pick = (x) => x.timestamp) =>
            arr.reduce((max, x) => {
              const t = Number(pick(x)) || 0;
              return t > max ? t : max;
            }, 0) || null;

          // ── Latest Water Test ──────────────────────────────────────────────
          const TEST_TYPES = new Set(["Quick Water Test", "Water Test", "Detailed Test"]);
          const testActionTs = maxTs(actionLogs.filter((l) => TEST_TYPES.has(l.actionType)));
          const paramReadingTs = maxTs(paramReadings);
          const onChainLogTs = maxTs(tank.logs || []);
          const latestLogTs = tank.latestLog ? Number(tank.latestLog.timestamp) || null : null;
          const latestTest = [testActionTs, paramReadingTs, onChainLogTs, latestLogTs]
            .filter((t) => t)
            .reduce((max, t) => (t > max ? t : max), 0) || null;

          // ── Latest Water Change ────────────────────────────────────────────
          // Structured actionType (and the backfilled payload.kind) only.
          const CHANGE_TYPES = new Set(["Water Change", "Log Immediate Water Change"]);
          const changeLogs = actionLogs.filter(
            (l) => CHANGE_TYPES.has(l.actionType) || l.payload?.kind === "waterChange"
          );
          const latestChange = maxTs(changeLogs);

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
