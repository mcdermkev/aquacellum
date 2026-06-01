import { db } from "../db";

/**
 * Handle Poseidon local actions atomically inside a Dexie read-write transaction.
 * @param {Object} actionPayload - The payload dispatched from the Poseidon worker
 * @param {string} actionPayload.type - The action type ("CREATE_TANK" | "LOG_HUSBANDRY")
 * @param {number} [actionPayload.tankId] - The ID of the active tank
 * @param {string} [actionPayload.walletAddress] - The active user's account key
 * @param {Array} [actionPayload.logs] - Pre-structured list of logs to import
 * @param {Object} [actionPayload.payload] - Additional raw query payloads
 */
export async function handlePoseidonAction(actionPayload) {
  if (!actionPayload || !actionPayload.type) return;

  try {
    await db.transaction('rw', [db.actionLogs, db.tanks, db.userProfile], async () => {
      const type = actionPayload.type;

      if (type === 'CREATE_TANK') {
        const rawQuery = (actionPayload.payload?.rawQuery || "").toLowerCase();
        
        // 1. Sensible defaults parsing from query
        let volumeGallons = 10;
        const gallonMatch = rawQuery.match(/(\d+)\s*gallons?/i);
        const literMatch = rawQuery.match(/(\d+)\s*liters?/i);
        
        if (gallonMatch) {
          volumeGallons = parseInt(gallonMatch[1], 10);
        } else if (literMatch) {
          volumeGallons = Math.round(parseInt(literMatch[1], 10) * 0.264172);
        }

        const volumeLiters = Math.round(volumeGallons * 3.78541);
        const ownerAddress = actionPayload.walletAddress || "0x0000000000000000000000000000000000000000";

        // Determine if saltwater
        const isSaltwater = rawQuery.includes("saltwater") || rawQuery.includes("marine") || rawQuery.includes("reef");
        const tankType = isSaltwater ? 2 : 1; // 2 = Saltwater, 1 = Freshwater

        // Parse temperature (10x scaling)
        let tempCelsiusX10 = 245; // 24.5 C default
        const tempMatch = rawQuery.match(/(\d+)\s*(degrees?|°c|°f|c|f)/i);
        if (tempMatch) {
          const val = parseInt(tempMatch[1], 10);
          if (rawQuery.includes("f")) {
            // Fahrenheit to Celsius
            const c = (val - 32) * 5 / 9;
            tempCelsiusX10 = Math.round(c * 10);
          } else {
            tempCelsiusX10 = val * 10;
          }
        }

        // Parse pH (10x scaling)
        let phX10 = 72; // 7.2 default
        const phMatch = rawQuery.match(/ph\s*(is|around|about|of)?\s*(\d+(\.\d+)?)/i);
        if (phMatch) {
          phX10 = Math.round(parseFloat(phMatch[2]) * 10);
        }

        const tankId = Date.now();
        const newTank = {
          id: tankId,
          ownerAddress,
          name: actionPayload.payload?.tankName || `Poseidon ${volumeGallons}G System`,
          tankType,
          containment: 0, // Tank
          volumeLiters,
          facility: "Main Room",
          room: "Home Office",
          rack: "Rack A",
          parentUnitId: 0,
          active: 1,
          specimens: [],
          logs: [
            {
              timestamp: Math.round(Date.now() / 1000),
              tempCelsiusX10,
              phX10,
              salinitySgX10000: isSaltwater ? 10250 : 10000,
              ammoniaPpmX100: 0,
              nitritePpmX100: 0,
              nitratePpmX100: 500, // 5.0 ppm
              notes: "System initialized via Poseidon setup guide."
            }
          ]
        };

        // Add tank
        await db.tanks.add(newTank);

        // Add matching action log entry
        await db.actionLogs.add({
          tankId,
          actionType: "System Setup",
          timestamp: Math.round(Date.now() / 1000),
          details: `Poseidon Setup: Configured new ${volumeLiters}L containment unit profile with target temp ${(tempCelsiusX10/10).toFixed(1)}°C and pH ${(phX10/10).toFixed(1)}.`
        });

        console.log(`[Poseidon Bridge] Successfully created tank #${tankId} for ${ownerAddress}`);

      } else if (type === 'LOG_HUSBANDRY') {
        const logs = actionPayload.logs || [];
        const tankId = Number(actionPayload.tankId || 0);

        if (logs.length === 0 && actionPayload.payload?.rawQuery) {
          const rawQuery = actionPayload.payload.rawQuery.toLowerCase();
          let actionType = "Quick Log";
          let details = "Routine Care Activity";

          if (rawQuery.includes("fed") || rawQuery.includes("feed")) {
            actionType = "Feed";
            details = "Routine Feeding (Logged via Poseidon)";
          } else if (rawQuery.includes("clean") || rawQuery.includes("scrape") || rawQuery.includes("glass")) {
            actionType = "Scraped Algae";
            details = "Routine Algae Scraped (Logged via Poseidon)";
          } else if (rawQuery.includes("test") || rawQuery.includes("parameter") || rawQuery.includes("ph")) {
            actionType = "Quick Water Test";
            details = "Baseline Water Test (Logged via Poseidon)";
          }

          logs.push({
            tankId,
            actionType,
            timestamp: Math.round(Date.now() / 1000),
            details
          });
        }

        for (const log of logs) {
          const targetTankId = Number(log.tankId || tankId);
          if (!targetTankId) continue;

          await db.actionLogs.add({
            tankId: targetTankId,
            actionType: log.actionType || "Quick Log",
            timestamp: Number(log.timestamp || Math.round(Date.now() / 1000)),
            details: log.details || "Routine Care Log Entry"
          });
        }

        console.log(`[Poseidon Bridge] Successfully logged ${logs.length} husbandry events.`);
      }
    });

    // Dispatch custom event to notify React hooks to refetch/sync state
    window.dispatchEvent(new CustomEvent("aquadex_xp_added", {
      detail: { reason: `Poseidon Action: ${actionPayload.type}` }
    }));

  } catch (error) {
    console.error("[Poseidon Bridge] Error executing database transaction:", error);
  }
}
