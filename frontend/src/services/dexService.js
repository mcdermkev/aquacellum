/**
 * dexService.js — "My Dex" + wishlist persistence and reconciliation (Fish
 * Finder Rework Task 9).
 *
 * Reframes "species in my tanks" (today just a residency filter,
 * `residingSpecies` in BreedGallery.jsx) into a rewarding, durable collection
 * log: once a species has been kept, it stays in the Dex even if every
 * specimen of it later leaves the tank (sold, died, moved) — same "discovery
 * persists" principle a real Pokédex uses. Backs the `dexEntries` and
 * `wishlist` tables added in db.js v24.
 *
 * XP: composes the existing `window.triggerXpTracking` bridge (useXPSync.js)
 * for the "Species Added to Collection" award (GAMIFICATION_SPEC.md §2.1,
 * XP_ACTIONS.ADD_SPECIES = 15 pts, no cooldown, one-time per species
 * instance) — this module does not compute XP amounts or touch Dexie's XP
 * tables directly. `reconcileDexFromTanks` is therefore the ONLY code path
 * that awards ADD_SPECIES XP: the compound `[walletAddress+speciesKey]`
 * primary key on `dexEntries` makes "have I already recorded this species"
 * an atomic existence check, so calling this repeatedly (it runs on every
 * Fish Finder mount) never double-awards for a species already in the Dex.
 *
 * `speciesKey` is always the lowercased scientificName — the durable,
 * catalog-agnostic identity key used elsewhere in Fish Finder (speciesFit.js,
 * discoveryIntents.js) because a species can carry different numeric
 * speciesIds across the on-chain and curated catalogs.
 */

import { db } from "../db.js";
import { XP_ACTIONS } from "../utils/xp.js";

function keyFor(scientificName) {
  return String(scientificName || "").trim().toLowerCase();
}

/**
 * Sentinel names that mean "this specimen's species could not be identified",
 * NOT a real species. `useUserTanks` sets scientificName to the literal string
 * "Unknown" when the on-chain speciesCatalog lookup fails or returns empty, so
 * without this guard an unidentified specimen would be recorded as a species
 * named "Unknown" and award ADD_SPECIES XP for it — a fabricated Dex entry and
 * a bogus reward. Treated exactly like a batch placeholder: skipped.
 */
const UNIDENTIFIED_KEYS = new Set(["unknown", "unknown species", "n/a", "none"]);

function isIdentifiedSpecies(scientificName) {
  const key = keyFor(scientificName);
  return !!key && !UNIDENTIFIED_KEYS.has(key);
}

/**
 * Read the full Dex (all species ever kept) for a wallet.
 * @param {string} walletAddress
 * @returns {Promise<Array<{walletAddress, speciesKey, commonName, firstKeptAt}>>}
 */
export async function getDexEntries(walletAddress) {
  if (!walletAddress) return [];
  try {
    return await db.dexEntries.where("walletAddress").equals(walletAddress.toLowerCase()).toArray();
  } catch {
    return [];
  }
}

/**
 * Reconcile the Dex against a keeper's real tanks: any species currently
 * residing in any tank that isn't already in the Dex gets added (one-time),
 * and the one-time "Species Added to Collection" XP fires for each newly
 * added entry via the existing XP bridge.
 *
 * Never removes an entry when a species is no longer resident — the Dex is a
 * "have I ever kept this" ledger, not a live residency mirror (that's what
 * `residingSpecies`/tank data already is).
 *
 * @param {string} walletAddress
 * @param {Array} tanks - from useUserTanks; each tank.specimens carries
 *   { speciesId, commonName, scientificName, isBatchPlaceholder? }
 * @returns {Promise<Array<{speciesKey, commonName}>>} newly-added entries (for a toast/reaction)
 */
export async function reconcileDexFromTanks(walletAddress, tanks) {
  if (!walletAddress || !Array.isArray(tanks) || tanks.length === 0) return [];
  const owner = walletAddress.toLowerCase();

  // Collect unique { speciesKey, commonName, scientificName } from residents
  // across all tanks. Batch placeholders (unregistered fry counts) and
  // specimens whose species couldn't be resolved (the "Unknown" sentinel that
  // useUserTanks falls back to) are skipped — the Dex only records identified
  // species, and only identified species earn the award.
  const seen = new Map();
  for (const tank of tanks) {
    for (const s of tank.specimens || []) {
      if (s.isBatchPlaceholder || !isIdentifiedSpecies(s.scientificName)) continue;
      const key = keyFor(s.scientificName);
      if (seen.has(key)) continue;
      seen.set(key, { speciesKey: key, commonName: s.commonName || s.scientificName, scientificName: s.scientificName });
    }
  }
  if (seen.size === 0) return [];

  const newlyAdded = [];

  try {
    await db.transaction("rw", db.dexEntries, async () => {
      const existing = await db.dexEntries.where("walletAddress").equals(owner).toArray();
      const existingKeys = new Set(existing.map((e) => e.speciesKey));

      const now = Date.now();
      for (const [key, info] of seen) {
        if (existingKeys.has(key)) continue;
        await db.dexEntries.add({
          walletAddress: owner,
          speciesKey: key,
          commonName: info.commonName,
          scientificName: info.scientificName,
          firstKeptAt: now,
        });
        newlyAdded.push(info);
      }
    });
  } catch (err) {
    console.warn("[dexService] reconcileDexFromTanks failed:", err?.message);
    return [];
  }

  // Award the one-time XP for each genuinely new entry, via the existing
  // bridge — never compute/apply XP directly here. `globalThis` (not
  // `window`) so this also works under a Node test environment.
  for (const info of newlyAdded) {
    if (typeof globalThis.triggerXpTracking === "function") {
      // Amount and label both come from the canonical action definition. The
      // label matters: useXPSync's mapReasonToActionKey resolves the free-text
      // reason back to an XP_ACTIONS key, and "Species Added to Collection"
      // lowercases to contain both "species" and "add" → ADD_SPECIES. Changing
      // this string can silently re-route the award to a different action.
      globalThis.triggerXpTracking(
        XP_ACTIONS.ADD_SPECIES.points,
        XP_ACTIONS.ADD_SPECIES.label,
        { speciesKey: info.speciesKey }
      );
    }
  }

  return newlyAdded;
}

/**
 * Is a species in the wishlist for this wallet?
 * @param {string} walletAddress
 * @param {string} scientificName
 * @returns {Promise<boolean>}
 */
export async function isWishlisted(walletAddress, scientificName) {
  if (!walletAddress || !scientificName) return false;
  try {
    const row = await db.wishlist.get([walletAddress.toLowerCase(), keyFor(scientificName)]);
    return !!row;
  } catch {
    return false;
  }
}

/** Read the full wishlist for a wallet. */
export async function getWishlist(walletAddress) {
  if (!walletAddress) return [];
  try {
    return await db.wishlist.where("walletAddress").equals(walletAddress.toLowerCase()).toArray();
  } catch {
    return [];
  }
}

/**
 * Toggle a species' wishlist membership. Returns the new state (true = now
 * wishlisted). No XP — wishlisting is a bookmark, not an achievement (only
 * genuinely keeping a species awards ADD_SPECIES XP, per reconcileDexFromTanks).
 * @param {string} walletAddress
 * @param {{speciesId?, commonName?, scientificName}} entry
 * @returns {Promise<boolean>}
 */
export async function toggleWishlist(walletAddress, entry) {
  if (!walletAddress || !entry?.scientificName) return false;
  const owner = walletAddress.toLowerCase();
  const key = keyFor(entry.scientificName);

  try {
    const existing = await db.wishlist.get([owner, key]);
    if (existing) {
      await db.wishlist.delete([owner, key]);
      return false;
    }
    await db.wishlist.add({
      walletAddress: owner,
      speciesKey: key,
      commonName: entry.commonName || entry.scientificName,
      scientificName: entry.scientificName,
      addedAt: Date.now(),
    });
    return true;
  } catch (err) {
    console.warn("[dexService] toggleWishlist failed:", err?.message);
    return false;
  }
}

/**
 * Dex completion against a full candidate catalog: how many of the known
 * species has this keeper ever kept? Read-only presentation math — no XP,
 * no writes. Never divides by zero.
 * @param {Array} dexEntries - from getDexEntries
 * @param {Array} catalog - full candidate catalog (global or contract entries)
 * @returns {{ keptCount:number, totalCount:number, percent:number }}
 */
export function computeDexCompletion(dexEntries, catalog) {
  // The percentage must be an INTERSECTION, not a ratio of two independent
  // counts. A keeper can hold species that aren't in the active candidate
  // catalog (the on-chain catalog and the curated global catalog don't contain
  // the same set), and counting those toward "% of the catalog" would overstate
  // completion — the same class of invented number the D3 purge removed.
  const catalogKeys = new Set(
    (Array.isArray(catalog) ? catalog : []).map((c) => keyFor(c?.scientificName)).filter(Boolean)
  );
  const keptKeys = new Set(
    (Array.isArray(dexEntries) ? dexEntries : []).map((e) => keyFor(e?.speciesKey)).filter(Boolean)
  );

  const totalCount = catalogKeys.size;
  let inCatalogCount = 0;
  for (const key of keptKeys) if (catalogKeys.has(key)) inCatalogCount++;

  // keptCount stays the keeper's TRUE Dex size (every species they've kept, in
  // the catalog or not) so "N species kept" is never understated; only the
  // percentage is scoped to the catalog.
  return {
    keptCount: keptKeys.size,
    inCatalogCount,
    totalCount,
    percent: totalCount > 0 ? Math.round((inCatalogCount / totalCount) * 100) : 0,
  };
}
