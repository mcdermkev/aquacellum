/**
 * spawnLogScan.js: the on-chain half of the hatchery timeline (HatcheryLogs).
 *
 * Walks spawnLogs(1, 2, ...) until the first empty record or failed read,
 * keeps the logs for one species, and attaches the active batch listing for
 * each (spawnToListing -> batchListings). Issued one by one that is one
 * eth_call per spawn id plus up to two per match, which the public Base
 * Sepolia RPC answers with HTTP 429.
 *
 * The Multicall3 path reads spawnLogs a window at a time and the listing
 * lookups in one request each; it falls back to the original per-call walk
 * when Multicall3 is unavailable. Both paths share the row builders, so they
 * return identical objects in the same order and stop at the same id.
 */
import { multicallRead } from "./contractCatalogReader";

/**
 * spawnLogs ids read per Multicall3 window. The walk stops at the first empty
 * record, so ids past the end come back empty and are ignored.
 */
export const SPAWN_LOG_WINDOW = 50;

const readFailed = (what) => new Error(`${what} read failed in Multicall3 batch`);

/** End of the walk: a missing or zero-id record (unseeded sequential id). */
const isEmptyLog = (log) => !log || log.spawnId === 0n || Number(log.spawnId) === 0;

/** spawnToListing answers 0 for a spawn with no listing. */
const hasListing = (listingId) => listingId > 0n;

const logSpeciesMatches = (log, specCode) => Number(log.speciesId) === Number(specCode);

const listingError = (spawnId, err) => console.error(`Error querying spawnToListing for spawn ${spawnId}:`, err);

// ─── Row builders (shared by the Multicall3 and direct paths) ────────────────

function buildListingDetails(listing) {
  return {
    listingId: Number(listing.listingId),
    spawnId: Number(listing.spawnId),
    quantity: Number(listing.quantity),
    pricePerFish: listing.pricePerFish.toString(),
    seller: listing.seller,
    isActive: listing.isActive,
  };
}

function buildLogRow(spawnId, log, listingDetails) {
  return {
    spawnId: spawnId,
    speciesId: Number(log.speciesId),
    breeder: log.breeder,
    eggCount: Number(log.eggCount),
    eventTimestamp: Number(log.eventTimestamp),
    notesIpfsHash: log.notesIpfsHash,
    listing: listingDetails,
  };
}

// ─── Multicall3 path ─────────────────────────────────────────────────────────

/**
 * Returns the rows, or null when Multicall3 is unavailable so the caller
 * falls back to the direct walk.
 */
async function readSpawnLogsBatched(spawnContract, marketplaceContract, specCode, mcOpts) {
  const matching = [];
  let start = 1;
  walk: for (;;) {
    const ids = [];
    for (let id = start; id < start + SPAWN_LOG_WINDOW; id++) ids.push(id);
    const logs = await multicallRead(spawnContract, "spawnLogs", ids.map((id) => [id]), mcOpts);
    if (!logs) return null;
    for (const log of logs) {
      // A failed read ends the walk, like the direct path's catch.
      if (isEmptyLog(log)) break walk;
      if (logSpeciesMatches(log, specCode)) matching.push({ spawnId: Number(log.spawnId), log });
    }
    start += SPAWN_LOG_WINDOW;
  }
  if (matching.length === 0) return [];

  const details = new Map(); // spawnId -> listing details
  if (marketplaceContract) {
    const listingIds = await multicallRead(marketplaceContract, "spawnToListing", matching.map(({ spawnId }) => [spawnId]), mcOpts);
    if (!listingIds) return null;

    const listed = [];
    matching.forEach(({ spawnId }, k) => {
      const listingId = listingIds[k];
      if (listingId == null) listingError(spawnId, readFailed("spawnToListing"));
      else if (hasListing(listingId)) listed.push({ spawnId, listingId });
    });

    if (listed.length > 0) {
      const listings = await multicallRead(marketplaceContract, "batchListings", listed.map(({ listingId }) => [listingId]), mcOpts);
      if (!listings) return null;
      listed.forEach(({ spawnId }, k) => {
        const listing = listings[k];
        if (!listing) {
          listingError(spawnId, readFailed("batchListings"));
          return;
        }
        try {
          if (listing.isActive) details.set(spawnId, buildListingDetails(listing));
        } catch (err) {
          listingError(spawnId, err);
        }
      });
    }
  }

  const rows = [];
  for (const { spawnId, log } of matching) {
    try {
      rows.push(buildLogRow(spawnId, log, details.get(spawnId) || null));
    } catch {
      break; // the direct walk's catch ends the walk
    }
  }
  return rows;
}

// ─── Direct path ─────────────────────────────────────────────────────────────

/** One eth_call per read. Used when Multicall3 is unavailable. */
async function readSpawnLogsDirect(spawnContract, marketplaceContract, specCode) {
  const rows = [];
  let id = 1;
  while (true) {
    try {
      const log = await spawnContract.spawnLogs(id);
      if (isEmptyLog(log)) {
        break;
      }
      if (logSpeciesMatches(log, specCode)) {
        const spawnId = Number(log.spawnId);
        let listingDetails = null;

        if (marketplaceContract) {
          try {
            const listingId = await marketplaceContract.spawnToListing(spawnId);
            if (hasListing(listingId)) {
              const listing = await marketplaceContract.batchListings(listingId);
              if (listing.isActive) {
                listingDetails = buildListingDetails(listing);
              }
            }
          } catch (err) {
            listingError(spawnId, err);
          }
        }

        rows.push(buildLogRow(spawnId, log, listingDetails));
      }
      id++;
    } catch {
      break;
    }
  }
  return rows;
}

/**
 * Read the on-chain spawn logs for one species, in spawn-id order, each with
 * its active batch listing (or null).
 *
 * @param {import("ethers").Contract} spawnContract  AquadexManager (provider-connected)
 * @param {import("ethers").Contract|null} marketplaceContract  AquadexMarketplace, or null to skip listings
 * @param {number|string} specCode  species id to keep
 * @param {object} [opts]
 * @param {import("ethers").Contract} [opts.multicall]  injected Multicall3 (tests)
 * @param {boolean} [opts.disableMulticall]  force the direct path (tests, live checks)
 * @returns {Promise<object[]>}
 */
export async function readSpawnLogsForSpecies(spawnContract, marketplaceContract, specCode, opts = {}) {
  if (!spawnContract) return [];
  const mcOpts = opts.multicall ? { multicall: opts.multicall } : {};
  let batched = null;
  if (!opts.disableMulticall) {
    try {
      batched = await readSpawnLogsBatched(spawnContract, marketplaceContract, specCode, mcOpts);
    } catch (err) {
      // e.g. an ABI without spawnLogs: the direct walk handles it the way it always has.
      console.warn("[spawnLogScan] Multicall3 path failed, falling back to single calls:", err?.message || err);
    }
  }
  return batched || await readSpawnLogsDirect(spawnContract, marketplaceContract, specCode);
}
