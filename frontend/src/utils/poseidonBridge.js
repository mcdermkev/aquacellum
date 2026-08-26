import { db } from "../db";
import { POSEIDON_ACTION, ACTION_CLASS, actionClass, normalizeActions } from "./poseidonActions";
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
 * Prefer an already-scaled field if the model sent one (`tempCelsiusX10: 255`
 * for 25.5°C). Only multiply the unscaled decimal fallback.
 * Blindly doing Number(p.temp) * 10 when the value is already 255 stores 2550
 * — a cook-the-fish bug. Missing field = omit. Never default ammonia to 0.
 */
function takeScaled(p, scaledKey, unscaled, factor) {
  if (p[scaledKey] != null && p[scaledKey] !== "" && Number.isFinite(Number(p[scaledKey]))) {
    return Math.round(Number(p[scaledKey]));
  }
  if (unscaled == null || unscaled === "" || !Number.isFinite(Number(unscaled))) return null;
  return Math.round(Number(unscaled) * factor);
}

async function writeCreateTank(actionPayload) {
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
  // Do not revive marine.
  const tankType = 0; // Freshwater

  // Parse temperature (10x scaling). Defaults 24.5°C / pH 7.2 are for a new
  // system only — never for a water test.
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
}

/**
 * LOG_HUSBANDRY writes actionLogs rows. Prefer structured logs[] (on the action
 * or payload) with actionType from the canonical list:
 *   Feed | Water Change | Quick Water Test | Scraped Algae | Observation |
 *   Treatment | Quick Log
 * Use Feed not Feeding. Mapping is payload actionType, not extra enum keys.
 *
 * actionLogs is the source of truth — do not invent lastFeeding / lastWaterChange
 * columns. Parse path is Poseidon chat + quick-log only; do not auto-ingest
 * tankNotes. Do not invent activity_score.
 *
 * rawQuery fallback (only when logs[] is missing): fed|feed → Feed;
 * water change|wc → Water Change; clean|scrape|glass → Scraped Algae;
 * test|parameter|ph → Quick Water Test.
 */
async function writeHusbandry(actionPayload) {
  const p = actionPayload.payload || {};
  const fromAction = Array.isArray(actionPayload.logs) && actionPayload.logs.length
    ? actionPayload.logs
    : null;
  const fromPayload = Array.isArray(p.logs) && p.logs.length ? p.logs : null;
  const logs = (fromAction || fromPayload || []).slice();
  const tankId = Number(actionPayload.tankId || p.tankId || 0);

  if (logs.length === 0 && p.rawQuery) {
    const rawQuery = String(p.rawQuery).toLowerCase();
    let actionType = "Quick Log";
    let details = "Routine Care Activity";

    if (rawQuery.includes("fed") || rawQuery.includes("feed")) {
      actionType = "Feed";
      details = "Routine Feeding (Logged via Poseidon)";
    } else if (rawQuery.includes("water change") || rawQuery.includes("wc")) {
      actionType = "Water Change";
      details = "Water change (Logged via Poseidon)";
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
}

/**
 * LOG_WATER_PARAMS. Fail closed if no tank or no readings.
 * Water-test actionType stays "Quick Water Test".
 *
 * Returns false when there is nothing usable to write, so the caller isn't told
 * a reading was saved when it wasn't.
 */
async function writeWaterParams(actionPayload) {
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
  //
  // takeScaled: if *X10 / *X100 / *X10000 are present, use as-is; else scale
  // from temp / ph / ammonia / nitrite / nitrate / salinity decimals.
  const reading = {
    tempCelsiusX10: takeScaled(p, "tempCelsiusX10", p.temp ?? p.tempCelsius, 10),
    phX10: takeScaled(p, "phX10", p.ph, 10),
    ammoniaPpmX100: takeScaled(p, "ammoniaPpmX100", p.ammonia, 100),
    nitritePpmX100: takeScaled(p, "nitritePpmX100", p.nitrite, 100),
    nitratePpmX100: takeScaled(p, "nitratePpmX100", p.nitrate, 100),
    salinitySgX10000: takeScaled(p, "salinitySgX10000", p.salinity, 10000),
  };

  const hasAnyReading = Object.values(reading).some((v) => v != null);
  if (!targetTankId || !hasAnyReading) {
    // Nothing usable. Fail loudly in the log rather than writing an empty
    // reading that would look like a completed water test.
    console.warn("[Poseidon Bridge] LOG_WATER_PARAMS ignored — no tank or no readings:", p);
    return false;
  }

  const tank = await db.tanks.get(targetTankId);
  if (!tank) {
    console.warn("[Poseidon Bridge] LOG_WATER_PARAMS ignored — tank not found:", targetTankId);
    return false;
  }

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
  return true;
}

/**
 * Dispatch one WRITE inside an already-open Dexie transaction.
 * Live types only — no alias enums.
 *
 * @returns {Promise<boolean>} false only when a water-params write found nothing
 */
async function executeWrite(actionPayload) {
  const type = actionPayload.type;

  if (type === POSEIDON_ACTION.CREATE_TANK || type === "CREATE_TANK") {
    await writeCreateTank(actionPayload);
    return true;
  }

  if (type === POSEIDON_ACTION.LOG_HUSBANDRY || type === "LOG_HUSBANDRY") {
    await writeHusbandry(actionPayload);
    return true;
  }

  if (type === POSEIDON_ACTION.LOG_WATER_PARAMS || type === "LOG_WATER_PARAMS") {
    return writeWaterParams(actionPayload);
  }

  return true;
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
 * Existing callers pass a single action. Batch callers should use
 * `handlePoseidonActions` so multiple WRITEs share one transaction / one commit.
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
  return handlePoseidonActions({ action: actionPayload });
}

/**
 * Run every WRITE / NAVIGATE from a Poseidon response in one commit.
 *
 * `normalizeActions` accepts singular `action` or `actions: []` (mixed notes:
 * LOG_HUSBANDRY + LOG_WATER_PARAMS). All WRITEs share one Dexie transaction.
 * NAVIGATE still runs outside the tx, after writes. One confirm chip, one
 * commit. Informational types are skipped.
 *
 * Until the UI wires `actions[]`, mixed notes still work if the caller passes
 * the response through handlePoseidonActions.
 *
 * @param {Object} response - Poseidon JSON, a single action, or `{ actions: [] }`
 * @returns {Promise<{ok: boolean, ran: boolean, reason?: string}>}
 */
export async function handlePoseidonActions(response) {
  const actions = normalizeActions(response);
  if (!actions.length) return { ok: false, ran: false, reason: "no-action" };

  const writes = [];
  const navs = [];

  for (const actionPayload of actions) {
    if (!actionPayload || !actionPayload.type) continue;
    const cls = actionClass(actionPayload.type);
    if (cls === ACTION_CLASS.INFORMATIONAL || cls === ACTION_CLASS.NONE) {
      continue;
    }
    if (cls === ACTION_CLASS.NAVIGATION) {
      navs.push(actionPayload);
    } else if (cls === ACTION_CLASS.WRITE) {
      writes.push(actionPayload);
    }
  }

  if (!writes.length && !navs.length) {
    return { ok: true, ran: false, reason: "informational" };
  }

  // Set to false by a write branch that found nothing usable to write, so the
  // caller isn't told a reading was saved when it wasn't. Any successful write
  // in a batch still counts — a care event must not roll back because params missed.
  let wrote = !writes.length;

  try {
    if (writes.length) {
      await db.transaction("rw", [db.actionLogs, db.tanks, db.userProfile], async () => {
        for (const actionPayload of writes) {
          const ok = await executeWrite(actionPayload);
          if (ok !== false) wrote = true;
        }
      });
    }

    if (writes.length && !wrote) return { ok: false, ran: false, reason: "nothing-to-write" };

    if (writes.length) {
      // Dispatch custom event to notify React hooks to refetch/sync state
      window.dispatchEvent(new CustomEvent("aquadex_xp_added", {
        detail: { reason: `Poseidon Action: ${writes.map((a) => a.type).join(", ")}` },
      }));
    }

    // Navigation runs OUTSIDE the transaction, after writes commit.
    let navResult = { ok: true };
    for (const actionPayload of navs) {
      navResult = runNavigate(actionPayload.payload || {});
    }

    if (!writes.length) {
      return { ok: navResult.ok, ran: navResult.ok, reason: navResult.reason };
    }

    return { ok: true, ran: true };
  } catch (error) {
    console.error("[Poseidon Bridge] Error executing database transaction:", error);
    return { ok: false, ran: false, reason: "error" };
  }
}
