import { db } from "../db";
import { POSEIDON_ACTION, ACTION_CLASS, actionClass } from "./poseidonActions";
import { guideEntryById, navTargetFor, APP_GUIDE } from "../services/appGuide";

/**
 * Resolve and dispatch a NAVIGATE action.
 *
 * Poseidon can only send a keeper to a destination that exists in the app guide
 * manifest (services/appGuide.js). That is deliberate: it means the assistant
 * cannot invent a route, and every target has already been asserted against
 * VALID_TABS and the real section lists by appGuide's drift test. An unknown
 * target is refused rather than guessed at.
 *
 * `aquadex:navigate-tab` is the channel — NOT `poseidon:navigate`. That one takes
 * only `{tab, search}`, so it cannot reach a section, and it bypasses
 * `handleTabChange`, so it skips the filter cleanup every other navigation does.
 *
 * This runs OUTSIDE the Dexie transaction below: it writes nothing, and firing a
 * UI event from inside a write transaction is a good way to have the event land
 * before the data it describes.
 */
function runNavigate(payload = {}) {
  let target = null;

  if (payload.guideId) {
    target = navTargetFor(guideEntryById(payload.guideId));
  } else if (payload.tab) {
    // Accept a raw tab/section pair only if the manifest actually lists it.
    const section = payload.section || null;
    const match = APP_GUIDE.find(
      (e) => e.tab === payload.tab && (e.section || null) === section
    );
    target = navTargetFor(match);
  }

  if (!target) {
    console.warn("[Poseidon Bridge] Refusing to navigate to an unlisted destination:", payload);
    return { ok: false, reason: "unknown-destination" };
  }

  window.dispatchEvent(new CustomEvent("aquadex:navigate-tab", { detail: target }));
  return { ok: true, target };
}

/**
 * Handle Poseidon local actions.
 *
 * Writes run atomically inside a Dexie read-write transaction. Navigation runs
 * outside it. Informational action types (QUERY_COMPATIBILITY, SUGGEST_SPECIES)
 * are explicit no-ops — the model's prose was the whole answer — and the hosts no
 * longer offer a confirm bar for them, so nothing invites a keeper to press a
 * button that does nothing. See utils/poseidonActions.js.
 *
 * @param {Object} actionPayload
 * @param {string} actionPayload.type - A POSEIDON_ACTION value
 * @param {number} [actionPayload.tankId] - The ID of the active tank
 * @param {string} [actionPayload.walletAddress] - The active user's account key
 * @param {Array} [actionPayload.logs] - Pre-structured list of logs to import
 * @param {Object} [actionPayload.payload] - Action-specific payload
 * @returns {Promise<{ok: boolean, ran: boolean, reason?: string}>}
 */
export async function handlePoseidonAction(actionPayload) {
  if (!actionPayload || !actionPayload.type) return { ok: false, ran: false, reason: "no-action" };

  const type = actionPayload.type;
  const cls = actionClass(type);

  // Nothing to execute. Returned honestly so a caller can tell "handled, no work"
  // apart from "failed".
  if (cls === ACTION_CLASS.INFORMATIONAL || cls === ACTION_CLASS.NONE) {
    return { ok: true, ran: false, reason: "informational" };
  }

  if (cls === ACTION_CLASS.NAVIGATION) {
    const res = runNavigate(actionPayload.payload || {});
    return { ok: res.ok, ran: res.ok, reason: res.reason };
  }

  // Set to false by a write branch that found nothing usable to write, so the
  // caller isn't told a reading was saved when it wasn't.
  let wrote = true;

  try {
    await db.transaction('rw', [db.actionLogs, db.tanks, db.userProfile], async () => {

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

        // Aquacellum is freshwater-only — saltwater is removed from the product.
        // Freshwater is enum index 0 (the previous `? 2 : 1` mapping was a bug:
        // it stored "freshwater" as index 1, which is actually Saltwater).
        const tankType = 0; // Freshwater

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
              salinitySgX10000: 10000,
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

      } else if (type === POSEIDON_ACTION.LOG_WATER_PARAMS) {
        // THE BUG THIS FIXES: this branch did not exist. The prompt advertised
        // LOG_WATER_PARAMS, the UI offered "Poseidon wants to: record water
        // parameters", and confirming it fell through the if/else chain and wrote
        // nothing — so the keeper believed a reading was saved when it was not.
        //
        // Written the same way the rest of the app writes a reading: appended to
        // the tank's `logs` with `latestLog` updated, using the fixed-point
        // scaling the schema stores (×10 temp/pH, ×100 nitrogen, ×10000 salinity)
        // — see services/relayer.relayLogWaterParameters, which owns this shape.
        // Inlined rather than called so the write stays inside this transaction.
        const targetTankId = Number(actionPayload.tankId || actionPayload.payload?.tankId || 0);
        const p = actionPayload.payload || {};

        // Only accept readings the model actually supplied. A missing value stays
        // missing — defaulting ammonia to 0 would fabricate a safe reading, which
        // is the one number a keeper acts on.
        const scaled = (value, factor) =>
          value == null || value === "" || !Number.isFinite(Number(value))
            ? null
            : Math.round(Number(value) * factor);

        const reading = {
          tempCelsiusX10: scaled(p.temp ?? p.tempCelsius, 10),
          phX10: scaled(p.ph, 10),
          ammoniaPpmX100: scaled(p.ammonia, 100),
          nitritePpmX100: scaled(p.nitrite, 100),
          nitratePpmX100: scaled(p.nitrate, 100),
          salinitySgX10000: scaled(p.salinity, 10000),
          // Hardness/alkalinity (local-only): dGH/dKH scaled ×10, alkalinity in ppm.
          ghX10: scaled(p.gh ?? p.generalHardness, 10),
          khX10: scaled(p.kh ?? p.carbonateHardness, 10),
          talPpm: scaled(p.tal ?? p.alkalinity, 1),
        };
        // Hardness/alkalinity are optional — drop them entirely when absent so a
        // reading without them doesn't persist a misleading 0 in the panel.
        for (const k of ["ghX10", "khX10", "talPpm"]) {
          if (reading[k] == null) delete reading[k];
        }

        const hasAnyReading = Object.values(reading).some((v) => v != null);
        if (!targetTankId || !hasAnyReading) {
          // Nothing usable. Fail loudly in the log rather than writing an empty
          // reading that would look like a completed water test.
          console.warn("[Poseidon Bridge] LOG_WATER_PARAMS ignored — no tank or no readings:", p);
          wrote = false;
        } else {
          const tank = await db.tanks.get(targetTankId);
          if (!tank) {
            console.warn("[Poseidon Bridge] LOG_WATER_PARAMS ignored — tank not found:", targetTankId);
            wrote = false;
          } else {
            const log = {
              timestamp: Math.round(Date.now() / 1000),
              ...reading,
              notes: p.notes || "Water test logged via Poseidon.",
            };
            const logs = tank.logs || [];
            logs.push(log);
            await db.tanks.update(targetTankId, { logs, latestLog: log });
            await db.actionLogs.add({
              tankId: targetTankId,
              actionType: "Quick Water Test",
              timestamp: log.timestamp,
              details: "Water test logged via Poseidon.",
            });
          }
        }
      }
    });

    if (!wrote) return { ok: false, ran: false, reason: "nothing-to-write" };

    // Dispatch custom event to notify React hooks to refetch/sync state
    window.dispatchEvent(new CustomEvent("aquadex_xp_added", {
      detail: { reason: `Poseidon Action: ${actionPayload.type}` }
    }));

    return { ok: true, ran: true };
  } catch (error) {
    console.error("[Poseidon Bridge] Error executing database transaction:", error);
    return { ok: false, ran: false, reason: "error" };
  }
}
