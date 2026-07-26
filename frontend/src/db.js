import Dexie from "dexie";

export const db = new Dexie("AquadexDB");

// Task 11 E2E harness (docs/TASK_11_E2E_SPEC.md): expose the live Dexie
// instance in-page so Playwright tests can seed/read tanks, specimens,
// schedules, etc. directly via `page.evaluate(() => window.__aquadexDb...)`,
// per the spec's "Dexie is reachable in-page" guidance. Dev-only — stripped
// from production bundles because `import.meta.env.DEV` is a build-time
// constant that Vite inlines to `false` for `npm run build`.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__aquadexDb = db;
  window.__seedForE2E = seedForE2E;
  window.__clearE2EDb = clearE2EDb;
}

/**
 * seedForE2E — writes a v23-shaped fixture directly into Dexie so Playwright
 * Phase B tests can seed a fresh, deterministic tank state without going
 * through the UI or a real wallet (docs/TASK_11_E2E_SPEC.md, "Phase B" /
 * "the auth + seed problem"). Dev-only (see window.__seedForE2E above).
 *
 * Mirrors the shapes relayRegisterTank / relayMintSpecimen write in
 * services/relayer.js, so seeded data is indistinguishable from real local-
 * first writes to the rest of the app (useUserTanks, deriveTankHealth, etc.).
 *
 * @param {object} fixture
 * @param {string} [fixture.ownerAddress] lowercase EOA; defaults to the E2E stub account
 * @param {Array<object>} [fixture.tanks] each: { id?, name, tankType, volumeLiters,
 *   facility?, room?, rack?, latestLog?, specimens?: [{ id?, speciesId, commonName,
 *   scientificName?, gender?, status? }], schedules?: [{ kind, cadenceDays?,
 *   lastDoneAt?, nextDueAt?, enabled? }], readings?: [{ timestamp?, temp?, ph?,
 *   ammonia?, nitrite?, nitrate?, source?, notes? }] }
 * @param {Array<object>} [fixture.unassignedSpecimens] nursery fixtures: same
 *   per-specimen shape as above, written with currentTankId 0.
 * @returns {Promise<{ tankIds: number[] }>}
 */
async function seedForE2E(fixture = {}) {
  const owner = (fixture.ownerAddress || "0xe2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2").toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const tankIds = [];
  let seq = 0;
  const nextId = () => Date.now() + (seq++);

  for (const t of fixture.tanks || []) {
    const tankId = t.id ?? nextId();
    const specimens = (t.specimens || []).map((s) => ({
      id: s.id ?? nextId(),
      speciesId: s.speciesId ?? 1,
      commonName: s.commonName || "Fish",
      scientificName: s.scientificName || "",
      status: s.status ?? 0,
      gender: s.gender || "Unsexed",
    }));

    await db.tanks.put({
      id: tankId,
      ownerAddress: owner,
      name: t.name || `Tank ${tankId}`,
      tankType: t.tankType ?? 0,
      volumeLiters: t.volumeLiters ?? 75,
      creationTimestamp: now,
      active: true,
      containment: 0,
      parentUnitId: 0,
      facility: t.facility || "Main Room",
      room: t.room || "Main Room",
      rack: t.rack || "",
      logs: [],
      latestLog: t.latestLog || null,
      specimens,
    });

    for (const s of specimens) {
      await db.specimens.put({
        id: s.id,
        ownerAddress: owner,
        speciesId: s.speciesId,
        currentTankId: tankId,
        status: s.status,
        gender: s.gender,
        commonName: s.commonName,
        scientificName: s.scientificName,
        breeder: owner,
        createdAt: now,
        onChainId: null,
        chainStatus: "local",
        txHash: null,
      });
    }

    for (const r of t.readings || []) {
      await db.paramReadings.add({
        tankId,
        timestamp: r.timestamp ?? now,
        temp: r.temp,
        ph: r.ph,
        ammonia: r.ammonia,
        nitrite: r.nitrite,
        nitrate: r.nitrate,
        source: r.source || "manual",
        notes: r.notes || "",
      });
    }

    for (const sch of t.schedules || []) {
      await db.tankSchedules.add({
        tankId,
        kind: sch.kind,
        cadenceDays: sch.cadenceDays ?? 7,
        lastDoneAt: sch.lastDoneAt ?? null,
        nextDueAt: sch.nextDueAt ?? now,
        enabled: sch.enabled !== false,
      });
    }

    tankIds.push(tankId);
  }

  for (const s of fixture.unassignedSpecimens || []) {
    const id = s.id ?? nextId();
    await db.specimens.put({
      id,
      ownerAddress: owner,
      speciesId: s.speciesId ?? 1,
      currentTankId: 0,
      status: s.status ?? 0,
      gender: s.gender || "Unsexed",
      commonName: s.commonName || "Fish",
      scientificName: s.scientificName || "",
      breeder: owner,
      createdAt: now,
      onChainId: null,
      chainStatus: "local",
      txHash: null,
    });
  }

  return { tankIds };
}

/** Clear all logbook-relevant local tables — used between E2E test scenarios. */
async function clearE2EDb() {
  await db.transaction(
    "rw",
    [db.tanks, db.specimens, db.paramReadings, db.tankSchedules, db.tankMedia, db.actionLogs, db.marketOrders],
    async () => {
      await db.tanks.clear();
      await db.specimens.clear();
      await db.paramReadings.clear();
      await db.tankSchedules.clear();
      await db.tankMedia.clear();
      await db.actionLogs.clear();
      await db.marketOrders.clear();
    }
  );
}

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

// Version 10: Add social layer cache tables for The Reef.
// feedCache: stores recent feed items for offline reading and instant load.
// socialNotifications: local mirror of Sonar notifications for offline display.
// draftContent: queued posts for offline-first creation (synced when back online).
db.version(10).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, level, prestigeXp, hobbyistXp, isCouncilMember",
  breederCompanion: "walletAddress, eggState, companionXp, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt"
});

// Version 11: Add per-account onboarding state to userProfile (onboarding-revamp spec).
// ADDITIVE / NON-DESTRUCTIVE: only the userProfile index list changes; existing records are
// preserved by Dexie's upgrade path and existing rows simply lack the new fields (treated as
// undefined/false until written). Dexie stores non-indexed fields automatically, so indexing
// is optional here — `onboardingComplete` is indexed to allow gate queries, while
// `onboardingPhase` is stored as a plain (non-indexed) field on the record.
//   - `onboardingComplete` (boolean): offline-first mirror of the Supabase
//       `profiles.onboarding_complete` flag; the source of truth for the first-login-only gate.
//       Defaults to undefined (falsy) for pre-existing accounts.
//   - `onboardingPhase` (string|null): resume point for an interrupted onboarding session
//       (e.g., "identity" | "nameConfirm" | "hatch" | "tourTank" | ...). Defaults to undefined.
db.version(11).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, level, prestigeXp, hobbyistXp, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, companionXp, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt"
});

// Version 12: Add specimens table for local-first specimen tracking (beta relayer).
// Stores minted specimens locally so "add fish to tank" never triggers MetaMask.
// Specimens are also embedded in the tank.specimens array for quick access,
// but this standalone table allows direct queries by owner or species.
db.version(12).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, level, prestigeXp, hobbyistXp, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, companionXp, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt"
});

// Version 13: Add marketplace local-first tables (beta relayer).
// Makes listings, purchases, escrow orders, and spawn records work without MetaMask.
//   - localListings: user-created beta listings (persistent; survives the on-chain
//       listings cache clear in useMarketplaceListings). Merged into board reads.
//   - marketOrders: purchase/escrow orders (shipping + batch) with status state machine.
//   - spawns: spawn records with offspring specimen IDs.
db.version(13).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, level, prestigeXp, hobbyistXp, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, companionXp, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt",
  localListings: "id, seller, speciesId, isBatch, listingId, tokenId",
  marketOrders: "++key, orderType, status, state, buyer, seller, tokenId, purchaseId, listingId",
  spawns: "spawnId, sireId, damId, tankId, speciesId, status, timestamp"
});

// Version 14: Add tankNotes table for freeform per-tank notes.
db.version(14).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, level, prestigeXp, hobbyistXp, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, companionXp, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt",
  localListings: "id, seller, speciesId, isBatch, listingId, tokenId",
  marketOrders: "++key, orderType, status, state, buyer, seller, tokenId, purchaseId, listingId",
  spawns: "spawnId, sireId, damId, tankId, speciesId, status, timestamp",
  tankNotes: "++id, tankId, createdAt"
});

// Version 15: Unified Gamification — merge prestigeXp + hobbyistXp into totalXp.
// Adds monthlyXp (resets each distribution period), rewardCredits (loyalty pool payouts),
// streakDays, lastActiveDate, and currentTier (cached from totalXp thresholds).
// The breederCompanion.companionXp is now derived from userProfile.totalXp.
// Migration: existing prestigeXp + hobbyistXp are summed into totalXp.
db.version(15).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, totalXp, currentTier, zoneHash, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt",
  localListings: "id, seller, speciesId, isBatch, listingId, tokenId",
  marketOrders: "++key, orderType, status, state, buyer, seller, tokenId, purchaseId, listingId",
  spawns: "spawnId, sireId, damId, tankId, speciesId, status, timestamp",
  tankNotes: "++id, tankId, createdAt",
  xpCooldowns: "++id, walletAddress, actionType, tankId, timestamp, [walletAddress+actionType+tankId]"
}).upgrade(async (tx) => {
  // Migrate existing users: sum prestigeXp + hobbyistXp → totalXp
  const profiles = await tx.table("userProfile").toArray();
  for (const profile of profiles) {
    const totalXp = (profile.prestigeXp || 0) + (profile.hobbyistXp || 0);
    const currentTier = deriveTierFromXp(totalXp);
    await tx.table("userProfile").put({
      ...profile,
      totalXp,
      currentTier,
      monthlyXp: 0,
      rewardCredits: 0,
      streakDays: 0,
      lastActiveDate: null,
      // Keep legacy fields for safety (non-indexed, won't cause issues)
      prestigeXp: profile.prestigeXp || 0,
      hobbyistXp: profile.hobbyistXp || 0,
    });
  }

  // Sync breederCompanion tier from totalXp
  const companions = await tx.table("breederCompanion").toArray();
  for (const companion of companions) {
    const profile = await tx.table("userProfile").get(companion.walletAddress);
    const totalXp = profile ? profile.totalXp : (companion.companionXp || 0);
    companion.currentTier = deriveTierFromXp(totalXp);
    // companionXp is now redundant — keep for reference but no longer authoritative
    await tx.table("breederCompanion").put(companion);
  }
});

// Version 16: Post-Purchase Arrival Flow (arrival-flow spec).
// Adds a compound index on specimens for efficient transit-state queries:
//   [ownerAddress+arrivalStatus] enables fast lookup of "my fish in transit".
// Also indexes marketOrders by assignedTankId for batch-arrival tank display.
//
// NEW NON-INDEXED FIELDS (stored automatically by Dexie, no index needed):
//   specimens:
//     - arrivalStatus: "transit" | "arrived" | null  — lifecycle state post-purchase
//     - purchasedAt: number | null                   — Unix timestamp of purchase
//     - arrivedAt: number | null                     — Unix timestamp of arrival confirmation
//     - acclimationNotes: string | null              — free-text notes from arrival flow
//     - purchaseType: "shipping"|"in-person"|"instant"|"fiat" | null
//     - purchaseOrderKey: string | null              — links to marketOrders record
//   marketOrders:
//     - assignedTankId: number | null                — tank assigned on batch arrival
//     - arrivedAt: number | null                     — when buyer confirmed batch arrival
//     - acclimationNotes: string | null              — notes for batch arrivals
//     - nudgeDismissedAt: number | null              — suppress nudge until this + 7d
db.version(16).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, totalXp, currentTier, zoneHash, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt, [ownerAddress+arrivalStatus]",
  localListings: "id, seller, speciesId, isBatch, listingId, tokenId",
  marketOrders: "++key, orderType, status, state, buyer, seller, tokenId, purchaseId, listingId, assignedTankId",
  spawns: "spawnId, sireId, damId, tankId, speciesId, status, timestamp",
  tankNotes: "++id, tankId, createdAt",
  xpCooldowns: "++id, walletAddress, actionType, tankId, timestamp, [walletAddress+actionType+tankId]"
});

// Version 17: Breeder Storefronts — adds storefrontCache table for offline-first
// storefront viewing. Caches full storefront payloads (profile + listings + stats)
// keyed by identifier (wallet or slug). Enables graceful offline degradation.
db.version(17).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, totalXp, currentTier, zoneHash, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt, [ownerAddress+arrivalStatus]",
  localListings: "id, seller, speciesId, isBatch, listingId, tokenId",
  marketOrders: "++key, orderType, status, state, buyer, seller, tokenId, purchaseId, listingId, assignedTankId",
  spawns: "spawnId, sireId, damId, tankId, speciesId, status, timestamp",
  tankNotes: "++id, tankId, createdAt",
  xpCooldowns: "++id, walletAddress, actionType, tankId, timestamp, [walletAddress+actionType+tankId]",
  storefrontCache: "id, walletAddress, cachedAt"
});

// Version 18: Canonical EOA address normalization.
// All ownerAddress / breeder / seller / buyer fields are lowercased so there's
// never a casing mismatch between the Privy EOA and stored records.
// Also rewrites any rows that were historically stored under the smart wallet
// to the EOA (both addresses are present in the same browser's IndexedDB,
// so we can find and unify them).
db.version(18).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, totalXp, currentTier, zoneHash, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt, [ownerAddress+arrivalStatus]",
  localListings: "id, seller, speciesId, isBatch, listingId, tokenId",
  marketOrders: "++key, orderType, status, state, buyer, seller, tokenId, purchaseId, listingId, assignedTankId",
  spawns: "spawnId, sireId, damId, tankId, speciesId, status, timestamp",
  tankNotes: "++id, tankId, createdAt",
  xpCooldowns: "++id, walletAddress, actionType, tankId, timestamp, [walletAddress+actionType+tankId]",
  storefrontCache: "id, walletAddress, cachedAt"
}).upgrade(async (tx) => {
  // Helper: lowercase an address (no-op if already lowercase or null/undefined)
  const norm = (addr) => (addr ? addr.toLowerCase() : addr);

  // 1. Collect all unique ownerAddresses to detect the EOA→smart wallet pair.
  //    The EOA is the one used by most records (tanks are always created with EOA).
  //    The smart wallet is any other non-test address that shares records with the same device.
  const tanks = await tx.table("tanks").toArray();
  const eoaCandidates = new Set(tanks.map(t => norm(t.ownerAddress)).filter(Boolean));

  // 2. Normalize tanks
  for (const tank of tanks) {
    if (tank.ownerAddress && tank.ownerAddress !== norm(tank.ownerAddress)) {
      await tx.table("tanks").update(tank.id, { ownerAddress: norm(tank.ownerAddress) });
    }
  }

  // 3. Normalize specimens — ownerAddress and breeder
  const specimens = await tx.table("specimens").toArray();
  for (const s of specimens) {
    const updates = {};
    if (s.ownerAddress && s.ownerAddress !== norm(s.ownerAddress)) {
      updates.ownerAddress = norm(s.ownerAddress);
    }
    if (s.breeder && s.breeder !== norm(s.breeder)) {
      updates.breeder = norm(s.breeder);
    }
    // If ownerAddress is not in eoaCandidates, it's probably the smart wallet.
    // Remap to the first (and likely only) EOA on this device.
    const normalOwner = norm(s.ownerAddress);
    if (normalOwner && !eoaCandidates.has(normalOwner) && eoaCandidates.size === 1) {
      updates.ownerAddress = [...eoaCandidates][0];
    }
    if (Object.keys(updates).length > 0) {
      await tx.table("specimens").update(s.id, updates);
    }
  }

  // 4. Normalize spawns — ownerAddress
  const spawns = await tx.table("spawns").toArray();
  for (const sp of spawns) {
    const updates = {};
    if (sp.ownerAddress && sp.ownerAddress !== norm(sp.ownerAddress)) {
      updates.ownerAddress = norm(sp.ownerAddress);
    }
    // Remap smart wallet to EOA
    const normalOwner = norm(sp.ownerAddress);
    if (normalOwner && !eoaCandidates.has(normalOwner) && eoaCandidates.size === 1) {
      updates.ownerAddress = [...eoaCandidates][0];
    }
    if (Object.keys(updates).length > 0) {
      await tx.table("spawns").update(sp.spawnId, updates);
    }
  }

  // 5. Normalize localListings — seller
  const listings = await tx.table("localListings").toArray();
  for (const l of listings) {
    if (l.seller && l.seller !== norm(l.seller)) {
      await tx.table("localListings").update(l.id, { seller: norm(l.seller) });
    }
  }

  // 6. Normalize marketOrders — buyer, seller
  const orders = await tx.table("marketOrders").toArray();
  for (const o of orders) {
    const updates = {};
    if (o.buyer && o.buyer !== norm(o.buyer)) updates.buyer = norm(o.buyer);
    if (o.seller && o.seller !== norm(o.seller)) updates.seller = norm(o.seller);
    if (Object.keys(updates).length > 0) {
      await tx.table("marketOrders").update(o.key, updates);
    }
  }

});

// Version 19: Echo Living Companion — add echoNeeds table for Tamagotchi-style needs persistence.
// Stores per-user need levels (hunger, clarity, comfort, curiosity, social) with lastUpdate timestamp.
// Also stores echoCompanionOnChain cache for offline rendering of on-chain DNA/state.
db.version(19).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, totalXp, currentTier, zoneHash, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt, [ownerAddress+arrivalStatus]",
  localListings: "id, seller, speciesId, isBatch, listingId, tokenId",
  marketOrders: "++key, orderType, status, state, buyer, seller, tokenId, purchaseId, listingId, assignedTankId",
  spawns: "spawnId, sireId, damId, tankId, speciesId, status, timestamp",
  tankNotes: "++id, tankId, createdAt",
  xpCooldowns: "++id, walletAddress, actionType, tankId, timestamp, [walletAddress+actionType+tankId]",
  storefrontCache: "id, walletAddress, cachedAt",
  echoNeeds: "walletAddress, lastUpdate",
  echoCompanionOnChain: "walletAddress, tokenId, cachedAt"
});

// Version 20: Breeder Stock Tags — add breederStockTag index on specimens table.
// Allows breeders to assign a short custom tag (e.g. "esgIV") to specimens for personal
// lineage tracking, separate from the auto-generated serial number. The tag is a free-text
// string stored on each specimen record. Indexed for fast lookup/filtering by tag.
db.version(20).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, totalXp, currentTier, zoneHash, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt, [ownerAddress+arrivalStatus], breederStockTag",
  localListings: "id, seller, speciesId, isBatch, listingId, tokenId",
  marketOrders: "++key, orderType, status, state, buyer, seller, tokenId, purchaseId, listingId, assignedTankId",
  spawns: "spawnId, sireId, damId, tankId, speciesId, status, timestamp",
  tankNotes: "++id, tankId, createdAt",
  xpCooldowns: "++id, walletAddress, actionType, tankId, timestamp, [walletAddress+actionType+tankId]",
  storefrontCache: "id, walletAddress, cachedAt",
  echoNeeds: "walletAddress, lastUpdate",
  echoCompanionOnChain: "walletAddress, tokenId, cachedAt"
});

// Version 21: On-chain reconciliation readiness (full-on-chain prep).
// ADDITIVE / NON-DESTRUCTIVE. Local serials (`id`) remain the stable client-side
// reference key. These new fields let a record carry its authoritative ERC-721
// token id once the on-chain mint confirms, without assuming id === tokenId
// (the contract assigns tokenId = ++totalSpecimensMinted, a global counter that
// can't be predicted client-side).
//   - `onChainId` (number|null): the confirmed on-chain token id. Indexed so we
//       can reverse-resolve a local record from an on-chain id. Null until synced.
//   - `chainStatus` (string): "local" | "pending" | "synced" | "failed". Indexed
//       to query un-synced specimens for the eventual backfill/flush. New mints
//       default to "pending" (an on-chain write is always enqueued); pre-existing
//       rows have no value (treated as "local").
//   - `txHash` (string|null): the tx that minted this specimen on-chain (audit).
db.version(21).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, totalXp, currentTier, zoneHash, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt, [ownerAddress+arrivalStatus], breederStockTag, onChainId, chainStatus",
  localListings: "id, seller, speciesId, isBatch, listingId, tokenId",
  marketOrders: "++key, orderType, status, state, buyer, seller, tokenId, purchaseId, listingId, assignedTankId",
  spawns: "spawnId, sireId, damId, tankId, speciesId, status, timestamp",
  tankNotes: "++id, tankId, createdAt",
  xpCooldowns: "++id, walletAddress, actionType, tankId, timestamp, [walletAddress+actionType+tankId]",
  storefrontCache: "id, walletAddress, cachedAt",
  echoNeeds: "walletAddress, lastUpdate",
  echoCompanionOnChain: "walletAddress, tokenId, cachedAt"
});

// Version 22: Persistent single-seller cart (Task 10). ADDITIVE / NON-DESTRUCTIVE —
// every v21 store is carried forward verbatim; only the new `cart` table is added.
//   - One row per carted listing (`id` = listingKey, e.g. "single-101" / "batch-7"),
//     not one row per cart — the cart itself is just "all rows in this table" for
//     the guest/local case. `seller` is indexed so cartStore can quickly confirm
//     the single-seller invariant without loading every field.
//   - `addedAt` indexed for chronological display without a full table scan.
//   - See services/cartModel.js for the full row shape and services/cartStore.js
//     for how this table is read/written (Dexie always; Supabase mirror only for
//     authenticated accounts).
db.version(22).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, totalXp, currentTier, zoneHash, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt, [ownerAddress+arrivalStatus], breederStockTag, onChainId, chainStatus",
  localListings: "id, seller, speciesId, isBatch, listingId, tokenId",
  marketOrders: "++key, orderType, status, state, buyer, seller, tokenId, purchaseId, listingId, assignedTankId",
  spawns: "spawnId, sireId, damId, tankId, speciesId, status, timestamp",
  tankNotes: "++id, tankId, createdAt",
  xpCooldowns: "++id, walletAddress, actionType, tankId, timestamp, [walletAddress+actionType+tankId]",
  storefrontCache: "id, walletAddress, cachedAt",
  echoNeeds: "walletAddress, lastUpdate",
  echoCompanionOnChain: "walletAddress, tokenId, cachedAt",
  cart: "id, seller, listingKey, addedAt"
});

// Version 23: Logbook Rework — data spine (Logbook Rework Task 1).
// ADDITIVE for the three new tables; the upgrade also does a one-time, idempotent,
// non-destructive backfill. Every v22 store is carried forward verbatim.
//   NEW TABLES
//   - paramReadings: first-class water-parameter readings (normalized units).
//       Replaces the split of on-chain tankParameterLogs vs. freeform actionLogs
//       as the UI source of truth. `source` = "manual" | "onchain" | "batch" |
//       "backfill". [tankId+timestamp] compound index for fast per-tank history.
//   - tankSchedules: per-tank maintenance cadence (waterChange | test | filter |
//       dose) with nextDueAt so "due/overdue" is a real value, not inferred.
//   - tankMedia: durable photo storage keyed by [refType+refId] (tank/specimen),
//       moving base64 photos off localStorage (5MB quota) onto Dexie + cloud sync.
//   NON-INDEXED ADDITION
//   - actionLogs gains a `payload` object (typed care detail) alongside the
//       human `details` string. Non-indexed, so the actionLogs schema string is
//       unchanged; Dexie stores it automatically.
//   MIGRATION (idempotent, non-destructive)
//   - Saltwater removal: any tank with tankType === 1 (legacy saltwater) is
//       converted to Freshwater (0). Aquacellum is freshwater-only; index 1 is
//       retired. See tankUtils.TANK_TYPE_OPTIONS.
//   - Backfill actionLogs.payload from parseable `details` (skips rows that
//       already have a payload).
//   - Seed paramReadings from historical water-test actionLogs where temp/pH can
//       be parsed from the details string (guarded against duplicates).
//   - Import any localStorage photos (aquadex_tank_photo_* / aquadex_specimen_photo_*)
//       into tankMedia. Photos are COPIED, not deleted — current UI still reads
//       localStorage; freeing it is deferred to the surface rework so nothing
//       visually breaks now.
db.version(23).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, totalXp, currentTier, zoneHash, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt, [ownerAddress+arrivalStatus], breederStockTag, onChainId, chainStatus",
  localListings: "id, seller, speciesId, isBatch, listingId, tokenId",
  marketOrders: "++key, orderType, status, state, buyer, seller, tokenId, purchaseId, listingId, assignedTankId",
  spawns: "spawnId, sireId, damId, tankId, speciesId, status, timestamp",
  tankNotes: "++id, tankId, createdAt",
  xpCooldowns: "++id, walletAddress, actionType, tankId, timestamp, [walletAddress+actionType+tankId]",
  storefrontCache: "id, walletAddress, cachedAt",
  echoNeeds: "walletAddress, lastUpdate",
  echoCompanionOnChain: "walletAddress, tokenId, cachedAt",
  cart: "id, seller, listingKey, addedAt",
  // NEW in v23:
  paramReadings: "++id, tankId, timestamp, source, [tankId+timestamp]",
  tankSchedules: "++id, tankId, kind, nextDueAt, enabled, [tankId+kind]",
  tankMedia: "++id, refType, refId, createdAt, [refType+refId]"
}).upgrade((tx) => upgradeV23(tx));

// v23 upgrade logic — extracted as a named export so the real transformations can
// be integration-tested against a controlled Dexie (see db/migrationV23.test.js).
export async function upgradeV23(tx) {
  // 1. Saltwater removal — convert legacy tankType === 1 records to Freshwater (0).
  try {
    const tanks = await tx.table("tanks").toArray();
    for (const t of tanks) {
      if (Number(t.tankType) === 1) {
        await tx.table("tanks").update(t.id, { tankType: 0 });
      }
    }
  } catch (e) {
    console.warn("[v23] Saltwater remap skipped:", e?.message);
  }

  // 2. Backfill actionLogs.payload from parseable `details` (idempotent: skip rows
  //    that already carry a payload).
  try {
    const parsePct = (s) => {
      const m = typeof s === "string" && s.match(/(\d{1,3})\s*%/);
      return m ? Number(m[1]) : undefined;
    };
    const parseNum = (s, label) => {
      const re = new RegExp(`${label}:\\s*([\\d.]+)`, "i");
      const m = typeof s === "string" && s.match(re);
      return m ? Number(m[1]) : undefined;
    };
    const payloadFor = (log) => {
      const d = log.details || "";
      switch (log.actionType) {
        case "Water Change":
        case "Log Immediate Water Change": {
          const percent = parsePct(d);
          return { kind: "waterChange", ...(percent !== undefined ? { percent } : {}), _backfilled: true };
        }
        case "Feed":
          return { kind: "feed", _backfilled: true };
        case "Scraped Algae":
          return { kind: "clean", _backfilled: true };
        case "Quick Water Test":
        case "Water Test":
        case "Detailed Test": {
          const temp = parseNum(d, "Temp");
          const ph = parseNum(d, "pH");
          return { kind: "test", ...(temp !== undefined ? { temp } : {}), ...(ph !== undefined ? { ph } : {}), _backfilled: true };
        }
        default:
          return { kind: "other", _backfilled: true };
      }
    };

    const logs = await tx.table("actionLogs").toArray();
    for (const log of logs) {
      if (log.payload) continue; // already structured — leave it
      await tx.table("actionLogs").update(log.id, { payload: payloadFor(log) });
    }

    // 3. Seed paramReadings from water-test action logs that carry parseable values.
    const testTypes = new Set(["Quick Water Test", "Water Test", "Detailed Test"]);
    for (const log of logs) {
      if (!testTypes.has(log.actionType)) continue;
      const temp = parseNum(log.details, "Temp");
      const ph = parseNum(log.details, "pH");
      if (temp === undefined && ph === undefined) continue;
      // Guard against duplicates if the upgrade is ever re-run.
      const existing = await tx.table("paramReadings")
        .where("[tankId+timestamp]").equals([log.tankId, log.timestamp]).count();
      if (existing > 0) continue;
      await tx.table("paramReadings").add({
        tankId: log.tankId,
        timestamp: log.timestamp,
        temp,
        ph,
        source: "backfill",
        notes: log.details || "",
      });
    }
  } catch (e) {
    console.warn("[v23] actionLogs/paramReadings backfill skipped:", e?.message);
  }

  // 4. Import localStorage photos into tankMedia (COPY, do not delete). Idempotent
  //    via the [refType+refId] guard. Current UI still reads localStorage; freeing
  //    it is deferred to the surface rework (Task 4/5).
  try {
    if (typeof localStorage !== "undefined") {
      const importPhoto = async (refType, refId, dataUrl) => {
        if (!dataUrl) return;
        const existing = await tx.table("tankMedia")
          .where("[refType+refId]").equals([refType, String(refId)]).count();
        if (existing > 0) return;
        await tx.table("tankMedia").add({
          refType,
          refId: String(refId),
          dataUrl,
          createdAt: Date.now(),
        });
      };
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith("aquadex_tank_photo_")) {
          await importPhoto("tank", key.replace("aquadex_tank_photo_", ""), localStorage.getItem(key));
        } else if (key.startsWith("aquadex_specimen_photo_")) {
          await importPhoto("specimen", key.replace("aquadex_specimen_photo_", ""), localStorage.getItem(key));
        }
      }
    }
  } catch (e) {
    console.warn("[v23] localStorage photo import skipped:", e?.message);
  }
}

// Version 24: Fish Finder Rework Task 9 — "My Dex" + wishlist.
// ADDITIVE / NON-DESTRUCTIVE — every v23 store carried forward verbatim; no
// upgrade function needed (both new tables start empty for every user).
//   - dexEntries: one row per (walletAddress, speciesKey) species the user has
//       actually kept (had a specimen residing in one of their tanks) at least
//       once. `speciesKey` is the lowercased scientificName — the same durable,
//       catalog-agnostic key `speciesFit.js`/`discoveryIntents.js` already use
//       to join contract entries to the curated master catalog — because a
//       given species can carry a DIFFERENT numeric speciesId in the on-chain
//       catalog vs. the curated global catalog, so speciesId alone can't be
//       the Dex's identity key. Compound primary key `[walletAddress+speciesKey]`
//       makes "have I already recorded this species for this user" an
//       upsert-safe existence check — the mechanism the one-time ADD_SPECIES
//       XP award (GAMIFICATION_SPEC §2.1, "no cooldown, one-time per species
//       instance") relies on to never double-award.
//   - wishlist: one row per (walletAddress, speciesKey) species the user has
//       saved for later from a Fish Finder card. Same compound-key shape;
//       toggling is add/delete on this row, not a status flag, so "is this
//       wishlisted" is a single indexed existence check.
db.version(24).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, totalXp, currentTier, zoneHash, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt, [ownerAddress+arrivalStatus], breederStockTag, onChainId, chainStatus",
  localListings: "id, seller, speciesId, isBatch, listingId, tokenId",
  marketOrders: "++key, orderType, status, state, buyer, seller, tokenId, purchaseId, listingId, assignedTankId",
  spawns: "spawnId, sireId, damId, tankId, speciesId, status, timestamp",
  tankNotes: "++id, tankId, createdAt",
  xpCooldowns: "++id, walletAddress, actionType, tankId, timestamp, [walletAddress+actionType+tankId]",
  storefrontCache: "id, walletAddress, cachedAt",
  echoNeeds: "walletAddress, lastUpdate",
  echoCompanionOnChain: "walletAddress, tokenId, cachedAt",
  cart: "id, seller, listingKey, addedAt",
  paramReadings: "++id, tankId, timestamp, source, [tankId+timestamp]",
  tankSchedules: "++id, tankId, kind, nextDueAt, enabled, [tankId+kind]",
  tankMedia: "++id, refType, refId, createdAt, [refType+refId]",
  // NEW in v24:
  dexEntries: "[walletAddress+speciesKey], walletAddress, speciesKey, firstKeptAt",
  wishlist: "[walletAddress+speciesKey], walletAddress, speciesKey, addedAt"
});

// Version 25: User-defined location groups for the Logbook location filter.
// ADDITIVE / NON-DESTRUCTIVE — every v24 store carried forward verbatim; no
// upgrade function needed (the new table starts empty for every user).
//   - tankGroups: one row per (ownerAddress, name) location group the user
//       created by hand — "Fish Room", "Basement Rack", "Greenhouse", whatever
//       they actually call it — replacing the previously hardcoded
//       ["Main Room", "Garage Rack", "Outdoor Ponds"] chip list.
//
//       A tank's group membership is NOT stored here. It stays on the tank
//       record's existing `facility` field (the top-level segment of the
//       facility › room › rack breadcrumb), so a group assignment survives in
//       the same place it always lived and still rides along to chain/relayer
//       writes. This table exists only so a group the user created can show up
//       as an EMPTY chip (zero tanks) — something a purely derived-from-tanks
//       list can't represent, and the thing you need for "make the group, then
//       drag tanks into it".
//
//       Compound primary key `[ownerAddress+name]` makes "does this user
//       already have a group by this name" a single indexed existence check,
//       and makes group creation idempotent (put = upsert). Rename is a
//       delete + put because the name participates in the primary key.
db.version(25).stores({
  species: "specCode, commonName, scientificName, type, difficulty",
  listings: "id, tokenId, seller, price, isBatch, speciesId",
  tanks: "id, ownerAddress, name, active",
  userProfile: "walletAddress, totalXp, currentTier, zoneHash, isCouncilMember, onboardingComplete",
  breederCompanion: "walletAddress, eggState, currentTier, selectedStats, zoneHash",
  pendingHandshakes: "purchaseId, pin, salt, buyerAddress",
  speciesManifest: "speciesId, scientificName, commonName, contractAddress, cachedAt",
  actionLogs: "++id, tankId, actionType, timestamp, details",
  spawnGrowout: "++id, spawnId, timestamp, type",
  feedCache: "++id, contentId, authorWallet, createdAt, [authorWallet+createdAt]",
  socialNotifications: "++id, category, isRead, createdAt",
  draftContent: "++id, type, status, createdAt",
  specimens: "id, ownerAddress, speciesId, currentTankId, status, createdAt, [ownerAddress+arrivalStatus], breederStockTag, onChainId, chainStatus",
  localListings: "id, seller, speciesId, isBatch, listingId, tokenId",
  marketOrders: "++key, orderType, status, state, buyer, seller, tokenId, purchaseId, listingId, assignedTankId",
  spawns: "spawnId, sireId, damId, tankId, speciesId, status, timestamp",
  tankNotes: "++id, tankId, createdAt",
  xpCooldowns: "++id, walletAddress, actionType, tankId, timestamp, [walletAddress+actionType+tankId]",
  storefrontCache: "id, walletAddress, cachedAt",
  echoNeeds: "walletAddress, lastUpdate",
  echoCompanionOnChain: "walletAddress, tokenId, cachedAt",
  cart: "id, seller, listingKey, addedAt",
  paramReadings: "++id, tankId, timestamp, source, [tankId+timestamp]",
  tankSchedules: "++id, tankId, kind, nextDueAt, enabled, [tankId+kind]",
  tankMedia: "++id, refType, refId, createdAt, [refType+refId]",
  dexEntries: "[walletAddress+speciesKey], walletAddress, speciesKey, firstKeptAt",
  wishlist: "[walletAddress+speciesKey], walletAddress, speciesKey, addedAt",
  // NEW in v25:
  tankGroups: "[ownerAddress+name], ownerAddress, name, createdAt, sortOrder"
});

/**
 * Derive tier key from totalXp using the canonical tier ladder.
 * Used by the v15 migration and shared with xp.js.
 */
export function deriveTierFromXp(totalXp) {
  const xp = Number(totalXp) || 0;
  if (xp >= 10000) return "Hadal";
  if (xp >= 5000) return "Abyssal";
  if (xp >= 2500) return "Pelagic";
  if (xp >= 1500) return "Coastal";
  return "Shallow";
}

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
