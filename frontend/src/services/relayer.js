/**
 * relayer.js
 * 
 * During beta, tanks and specimens are stored locally in Dexie.js (offline-first).
 * On-chain registration is deferred until the user "publishes" their data.
 * This avoids the ownership mismatch (relayer wallet vs user wallet) and
 * prevents MetaMask from popping up for routine actions.
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

/**
 * Mint a specimen locally in Dexie (beta mode — no on-chain write).
 * Adds the specimen to the target tank's specimens array and to the
 * standalone specimens table for direct queries.
 */
export async function relayMintSpecimen({
  speciesId,
  birthTimestamp = 0,
  breeder = "",
  currentTankId = 0,
  sireId = 0,
  damId = 0,
  ipfsMetadataUri = "",
  ownerAddress = "",
  commonName = "",
  scientificName = "",
} = {}) {
  try {
    const specimenId = Date.now();

    const specimen = {
      id: specimenId,
      speciesId: Number(speciesId),
      birthTimestamp,
      breeder,
      currentTankId: Number(currentTankId),
      sireId: Number(sireId),
      damId: Number(damId),
      ipfsMetadataUri,
      ownerAddress,
      commonName,
      scientificName,
      status: 0, // Active
      createdAt: Math.floor(Date.now() / 1000),
    };

    // Store in standalone specimens table
    await db.specimens.put(specimen);

    // Also embed in the tank's specimens array if a tank is specified
    if (currentTankId && Number(currentTankId) !== 0) {
      const tank = await db.tanks.get(Number(currentTankId));
      if (tank) {
        const specimens = tank.specimens || [];
        specimens.push({
          id: specimenId,
          speciesId: Number(speciesId),
          commonName,
          scientificName,
          status: 0,
        });
        await db.tanks.update(Number(currentTankId), { specimens });
      }
    }

    return { success: true, specimenId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local specimen mint failed:", err);
    return { success: false, error: err.message || "Failed to save specimen" };
  }
}

/**
 * Move a specimen between tanks locally in Dexie (beta mode — no on-chain write).
 * Removes the specimen from the source tank's array and adds it to the target.
 */
export async function relayMoveSpecimen({
  specimenId,
  targetTankId,
} = {}) {
  try {
    specimenId = Number(specimenId);
    targetTankId = Number(targetTankId);

    // Update the specimen record
    const specimen = await db.specimens.get(specimenId);
    if (!specimen) {
      return { success: false, error: "Specimen not found" };
    }

    const sourceTankId = specimen.currentTankId;

    // Remove from source tank's specimens array
    if (sourceTankId && sourceTankId !== 0) {
      const sourceTank = await db.tanks.get(sourceTankId);
      if (sourceTank) {
        const filtered = (sourceTank.specimens || []).filter(s => s.id !== specimenId);
        await db.tanks.update(sourceTankId, { specimens: filtered });
      }
    }

    // Add to target tank's specimens array
    if (targetTankId !== 0) {
      const targetTank = await db.tanks.get(targetTankId);
      if (targetTank) {
        const specimens = targetTank.specimens || [];
        specimens.push({
          id: specimenId,
          speciesId: specimen.speciesId,
          commonName: specimen.commonName,
          scientificName: specimen.scientificName,
          status: specimen.status,
        });
        await db.tanks.update(targetTankId, { specimens });
      }
    }

    // Update specimen's currentTankId
    await db.specimens.update(specimenId, { currentTankId: targetTankId });

    return { success: true, specimenId, targetTankId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local specimen move failed:", err);
    return { success: false, error: err.message || "Failed to move specimen" };
  }
}

/**
 * Log water parameters locally in Dexie (beta mode — no on-chain write).
 * Appends the log to the tank's logs array and updates latestLog.
 */
export async function relayLogWaterParameters({
  tankId,
  tempCelsiusX10,
  phX10,
  salinitySgX10000,
  ammoniaPpmX100,
  nitritePpmX100,
  nitratePpmX100,
  notes = "",
} = {}) {
  try {
    tankId = Number(tankId);

    const tank = await db.tanks.get(tankId);
    if (!tank) {
      return { success: false, error: "Tank not found" };
    }

    const log = {
      timestamp: Math.floor(Date.now() / 1000),
      tempCelsiusX10,
      phX10,
      salinitySgX10000,
      ammoniaPpmX100,
      nitritePpmX100,
      nitratePpmX100,
      notes,
    };

    const logs = tank.logs || [];
    logs.push(log);

    await db.tanks.update(tankId, { logs, latestLog: log });

    return { success: true, tankId, logIndex: logs.length - 1, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local water parameter log failed:", err);
    return { success: false, error: err.message || "Failed to log parameters" };
  }
}
