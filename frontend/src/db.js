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
