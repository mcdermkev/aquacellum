import Dexie from "dexie";

export const db = new Dexie("AquadexDB");

// Define schema: primary key first, followed by indexed fields.
// Non-indexed fields are saved automatically inside the stored objects.
db.version(1).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active"
});

// Version 2: Add userProfile table for gamification states
db.version(2).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, level, prestigeXp, hobbyistXp, isCouncilMember"
});

// Version 4: Add breederCompanion table for tracking passive easter egg companion
db.version(4).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, level, prestigeXp, hobbyistXp, isCouncilMember",
  breederCompanion: "walletAddress, eggState, companionXp, currentTier, selectedStats, zoneHash"
});

// Version 5: Add pendingHandshakes table for tracking pending handshake pre-images
db.version(5).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, level, prestigeXp, hobbyistXp, isCouncilMember",
  breederCompanion: "walletAddress, eggState, companionXp, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress"
});

// Version 6: Extension for Breeder Companion regional ranking optimization
db.version(6).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, level, prestigeXp, hobbyistXp, isCouncilMember",
  breederCompanion: "walletAddress, eggState, companionXp, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress"
});

// Version 7: Add speciesManifest table for caching curator-approved on-chain species catalog.
// Enables offline-first reads of the species manifest without requiring a live contract call.
// Populated by useContractSpecies after each successful on-chain fetch; read during offline fallback.
db.version(7).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, level, prestigeXp, hobbyistXp, isCouncilMember",
  breederCompanion: "walletAddress, eggState, companionXp, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt"
});

// Version 8: Add actionLogs table for routine tank husbandry actions logging.
// NOTE ON LOCAL-FIRST COMPANION STORAGE:
// The `breederCompanion` table maps the following local-first attributes to support Poseidon + Echo companion gamification:
//   - `walletAddress`: Serving as the primary key, mapping the companion state directly to the active user's account key.
//   - `eggState`: Local state tracking the egg status (e.g., 1 = active egg/hatched state, 0/2 = post-hatched or idle states).
//   - `companionXp`: Monotonically increasing counter updated when users trigger conversational husbandry logs via Poseidon.
//   - `currentTier`: Evaluated tier string mapped dynamically based on XP milestones (Bronze, Silver, Gold, Master, God-Tier).
// Under local-first updates, write operations will be performed transactionally via `db.breederCompanion.update(userAccountKey, { companionXp, currentTier, eggState })`
// within action event handlers to ensure offline data integrity.
db.version(8).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, level, prestigeXp, hobbyistXp, isCouncilMember",
  breederCompanion: "walletAddress, eggState, companionXp, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details"
});

// Version 9: Add spawnGrowout table for tracking fry survival, culls, and sales over time.
// Enables the spawn → grow-out lifecycle view without requiring on-chain writes for every checkpoint.
// Each row is a dated checkpoint for a specific spawnId.
db.version(9).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, level, prestigeXp, hobbyistXp, isCouncilMember",
  breederCompanion: "walletAddress, eggState, companionXp, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type"
});

/**
 * 1. FULL LEXICAL JSON DATA EXPORT:
 * Interfaces directly with our Dexie.js database layers.
 * Extracts species, listings, tanks, actionLogs, and userProfile.
 */
export async function exportLocalDatabase() {
  try {
    const tables = ["species", "listings", "tanks", "actionLogs", "userProfile", "spawnGrowout"];
    const backupData = {
      aquadex_backup: true,
      timestamp: Math.floor(Date.now() / 1000),
      schema_version: 2,
      data: {},
      localStorageBlobs: {}
    };

    for (const tableName of tables) {
      if (db[tableName]) {
        backupData.data[tableName] = await db[tableName].toArray();
      }
    }

    // Sweep localStorage for photos and metadata
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("aquadex_tank_photo_") || 
                  key.startsWith("aquadex_specimen_photo_") || 
                  key.startsWith("aquadex_specimen_metadata_"))) {
        backupData.localStorageBlobs[key] = localStorage.getItem(key);
      }
    }

    // Trigger browser file download
    const jsonStr = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    // YYYY-MM-DD
    const dateStr = new Date().toISOString().split("T")[0];
    const fileName = `aquadex_facility_backup_${dateStr}.json`;
    
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    return true;
  } catch (error) {
    console.error("Failed to export database:", error);
    throw error;
  }
}

/**
 * 2. ATOMIC LEDGER IMPORT & INTEGRITY RECOVERY:
 * Parses the uploaded JSON, validates aquadex_backup, and restores inside a transaction.
 */
export async function importLocalDatabase(jsonData) {
  if (!jsonData || jsonData.aquadex_backup !== true) {
    throw new Error("Invalid backup file: master 'aquadex_backup' flag not found.");
  }

  const tablesToRestore = ["species", "listings", "tanks", "actionLogs", "userProfile", "spawnGrowout"];
  const transactionStores = tablesToRestore.map(name => db[name]);

  // Execute atomically in a single write transaction
  await db.transaction("rw", transactionStores, async () => {
    for (const tableName of tablesToRestore) {
      if (jsonData.data[tableName]) {
        // Clear existing records
        await db[tableName].clear();
        // Insert new records bulk
        if (jsonData.data[tableName].length > 0) {
          await db[tableName].bulkAdd(jsonData.data[tableName]);
        }
      }
    }
  });

  let blobFailures = 0;
  // Restore localStorage items if they exist (schema_version >= 2)
  if (jsonData.localStorageBlobs) {
    for (const [key, value] of Object.entries(jsonData.localStorageBlobs)) {
      try {
        localStorage.setItem(key, value);
      } catch (err) {
        blobFailures++;
        console.warn(`Failed to restore local storage key ${key} - likely quota exceeded.`);
      }
    }
  }

  return { success: true, blobFailures };
}
