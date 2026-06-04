/**
 * relayer.js
 * 
 * During beta, tanks are stored locally in Dexie.js (offline-first).
 * On-chain registration is deferred until the user "publishes" their data.
 * This avoids the ownership mismatch (relayer wallet vs user wallet).
 */

import { db } from "../db";

/**
 * Register a tank locally in Dexie (beta mode — no on-chain write).
 * Returns a generated tank ID and stores it in the local database.
 */
export async function relayRegisterTank({
  name = "My Tank",
  tankType = 0,
  volumeLiters = 75,
  containment = 0,
  parentUnitId = 0,
  facility = "Main Room",
  room = "",
  rack = "",
  ownerAddress = "",
} = {}) {
  try {
    // Generate a local tank ID (timestamp-based, unique enough for beta)
    const tankId = Date.now();

    const tank = {
      id: tankId,
      ownerAddress,
      name,
      tankType,
      volumeLiters,
      creationTimestamp: Math.floor(Date.now() / 1000),
      active: true,
      containment,
      parentUnitId,
      facility,
      room,
      rack,
      logs: [],
      latestLog: null,
      specimens: [],
    };

    // Store in Dexie
    await db.tanks.put(tank);

    return { success: true, tankId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local tank registration failed:", err);
    return { success: false, error: err.message || "Failed to save tank" };
  }
}
