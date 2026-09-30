import { Contract } from "ethers";
import managerAbi from "../abi/AquadexManager.json";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { multicallRead } from "../services/contractCatalogReader";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * batchListings ids read per Multicall3 window. The marketplace keeps its
 * batch counter internal (no getter), so the scan walks ids until the first
 * empty record; reading a window at a time costs one request per window
 * instead of one per id. Ids past the end come back empty and are ignored.
 */
export const BATCH_LISTING_WINDOW = 50;

// ─── Row builders (shared by the Multicall3 and direct paths) ────────────────

function buildSpecimenRow(i, listing, spec, species) {
  // v2 stores on-chain price as USD *cents* (Web2-masked marketplace),
  // NOT wei. Interpret it as cents so display + Stripe checkout match
  // the local/cloud listing shape (priceCentsUSD is what checkout uses).
  const priceCents = Number(listing.price.toString());
  const shipCents = Number(listing.shippingFee.toString());
  const priceDisplayUsd = (priceCents / 100).toFixed(2);
  const shipDisplayUsd = (shipCents / 100).toFixed(2);

  return {
    id: i, // tokenId for single listings
    tokenId: i,
    seller: listing.seller,
    price: priceDisplayUsd,
    priceUsd: priceDisplayUsd,
    priceCentsUSD: priceCents,
    rawPrice: priceDisplayUsd,
    shippingFee: shipDisplayUsd,
    shippingFeeCents: shipCents,
    isShipping: listing.isShipping,
    speciesId: Number(spec.speciesId),
    commonName: species.commonName,
    scientificName: species.scientificName,
    sireId: Number(spec.sireId),
    damId: Number(spec.damId),
    ipfsMetadataUri: spec.ipfsMetadataUri,
    birthTimestamp: Number(spec.birthTimestamp),
    careLevel: Number(species.careLevel),
    minTemp: Number(species.minTempCelsiusX10) / 10,
    maxTemp: Number(species.maxTempCelsiusX10) / 10,
    minPh: Number(species.minPhX10) / 10,
    maxPh: Number(species.maxPhX10) / 10,
    isBatch: false,
  };
}

function buildBatchRow(listingId, batch, batchSpeciesId, species) {
  // v2 stores pricePerFish as USD *cents*, not wei (see note above).
  const perFishCents = Number(batch.pricePerFish.toString());
  const perFishDisplayUsd = (perFishCents / 100).toFixed(2);

  return {
    id: listingId, // listingId for batch listings
    listingId: listingId,
    spawnId: Number(batch.spawnId),
    quantity: Number(batch.quantity),
    price: perFishDisplayUsd, // display price per fish (USD)
    priceUsd: perFishDisplayUsd,
    priceCentsUSD: perFishCents,
    pricePerFishCents: perFishCents,
    rawPrice: perFishDisplayUsd,
    seller: batch.seller,
    isActive: batch.isActive,
    speciesId: batchSpeciesId,
    commonName: `${species.commonName} Fry Batch`,
    scientificName: species.scientificName,
    careLevel: Number(species.careLevel),
    minTemp: Number(species.minTempCelsiusX10) / 10,
    maxTemp: Number(species.maxTempCelsiusX10) / 10,
    minPh: Number(species.minPhX10) / 10,
    maxPh: Number(species.maxPhX10) / 10,
    isBatch: true,
    isShipping: false, // batch purchases support pickup/shipping in checkout
    shippingFee: "0",
  };
}

const matchesSpecies = (speciesId, id) => !speciesId || Number(id) === Number(speciesId);

const readFailed = (what) => new Error(`${what} read failed in Multicall3 batch`);

/** speciesCatalog for each distinct id, via Multicall3. Map id -> Result|null, or null to fall back. */
async function readSpeciesMap(managerContract, speciesIds, mcOpts) {
  const unique = [...new Set(speciesIds)];
  const rows = await multicallRead(managerContract, "speciesCatalog", unique.map((id) => [id]), mcOpts);
  if (!rows) return null;
  return new Map(unique.map((id, k) => [id, rows[k]]));
}

// ─── Individual specimen listings ────────────────────────────────────────────

/**
 * Multicall3 path: listings(1..N), then specimens(active), then
 * speciesCatalog(distinct matching species). About 3 requests for the whole
 * scan instead of 1 + 3 per active listing + 1 per id. Returns null so the
 * caller falls back to the direct path.
 */
async function readSpecimenListingsBatched(speciesId, managerContract, marketContract, totalSpecimens, mcOpts) {
  const ids = [];
  for (let i = 1; i <= totalSpecimens; i++) ids.push(i);

  const listings = await multicallRead(marketContract, "listings", ids.map((i) => [i]), mcOpts);
  if (!listings) return null;

  const active = [];
  ids.forEach((i, k) => {
    const listing = listings[k];
    if (!listing) {
      console.warn(`Error reading specimen listing for token ID ${i}:`, readFailed("listings"));
      return;
    }
    // Verify listing activity flag in Listings mapping
    if (listing.active) active.push({ i, listing });
  });
  if (active.length === 0) return [];

  const specs = await multicallRead(managerContract, "specimens", active.map(({ i }) => [i]), mcOpts);
  if (!specs) return null;

  const matching = [];
  active.forEach((entry, k) => {
    const spec = specs[k];
    if (!spec) {
      console.warn(`Error reading specimen listing for token ID ${entry.i}:`, readFailed("specimens"));
      return;
    }
    if (matchesSpecies(speciesId, spec.speciesId)) matching.push({ ...entry, spec });
  });
  if (matching.length === 0) return [];

  const speciesMap = await readSpeciesMap(managerContract, matching.map(({ spec }) => Number(spec.speciesId)), mcOpts);
  if (!speciesMap) return null;

  const rows = [];
  for (const { i, listing, spec } of matching) {
    const species = speciesMap.get(Number(spec.speciesId));
    if (!species) {
      console.warn(`Error reading specimen listing for token ID ${i}:`, readFailed("speciesCatalog"));
      continue;
    }
    rows.push(buildSpecimenRow(i, listing, spec, species));
  }
  return rows;
}

/** Direct path: one eth_call per read. Used when Multicall3 is unavailable. */
async function readSpecimenListingsDirect(speciesId, managerContract, marketContract, totalSpecimens) {
  const rows = [];
  for (let i = 1; i <= totalSpecimens; i++) {
    try {
      const listing = await marketContract.listings(i);
      // Verify listing activity flag in Listings mapping
      if (listing.active) {
        const spec = await managerContract.specimens(i);
        if (matchesSpecies(speciesId, spec.speciesId)) {
          const species = await managerContract.speciesCatalog(Number(spec.speciesId));
          rows.push(buildSpecimenRow(i, listing, spec, species));
        }
      }
    } catch (err) {
      console.warn(`Error reading specimen listing for token ID ${i}:`, err);
    }
  }
  return rows;
}

// ─── Batch (fry) listings ────────────────────────────────────────────────────

/**
 * Multicall3 path. Walks batchListings in windows until the first empty
 * record (zero seller) or failed read, exactly where the direct walk stops,
 * then reads spawnLogs(active) and speciesCatalog(distinct matching species).
 * Returns null so the caller falls back to the direct path.
 */
async function readBatchListingsBatched(speciesId, managerContract, marketContract, mcOpts) {
  const found = [];
  let start = 1;
  walk: for (;;) {
    const ids = [];
    for (let id = start; id < start + BATCH_LISTING_WINDOW; id++) ids.push(id);
    const batches = await multicallRead(marketContract, "batchListings", ids.map((id) => [id]), mcOpts);
    if (!batches) return null;
    for (let k = 0; k < ids.length; k++) {
      const batch = batches[k];
      if (!batch) {
        console.warn(`Error reading batch listing for ID ${ids[k]}:`, readFailed("batchListings"));
        break walk; // Out of bounds error
      }
      // Stop checking if we hit empty records (unseeded sequential IDs)
      if (batch.seller === ZERO_ADDRESS) break walk;
      found.push({ listingId: ids[k], batch });
    }
    start += BATCH_LISTING_WINDOW;
  }

  // Verify listing activity flag in BatchListings mapping
  const active = found.filter(({ batch }) => batch.isActive);
  if (active.length === 0) return [];

  const spawns = await multicallRead(managerContract, "spawnLogs", active.map(({ batch }) => [Number(batch.spawnId)]), mcOpts);
  if (!spawns) return null;

  // The direct walk stops at the first listing whose follow-up reads fail, so
  // only listings before that point are eligible.
  const matching = [];
  for (let k = 0; k < active.length; k++) {
    const spawn = spawns[k];
    if (!spawn) {
      console.warn(`Error reading batch listing for ID ${active[k].listingId}:`, readFailed("spawnLogs"));
      break;
    }
    const batchSpeciesId = Number(spawn.speciesId);
    if (matchesSpecies(speciesId, batchSpeciesId)) matching.push({ ...active[k], batchSpeciesId });
  }
  if (matching.length === 0) return [];

  const speciesMap = await readSpeciesMap(managerContract, matching.map(({ batchSpeciesId }) => batchSpeciesId), mcOpts);
  if (!speciesMap) return null;

  const rows = [];
  for (const { listingId, batch, batchSpeciesId } of matching) {
    const species = speciesMap.get(batchSpeciesId);
    if (!species) {
      console.warn(`Error reading batch listing for ID ${listingId}:`, readFailed("speciesCatalog"));
      break;
    }
    rows.push(buildBatchRow(listingId, batch, batchSpeciesId, species));
  }
  return rows;
}

/** Direct path: one eth_call per read. Used when Multicall3 is unavailable. */
async function readBatchListingsDirect(speciesId, managerContract, marketContract) {
  const rows = [];
  let listingId = 1;
  while (true) {
    try {
      const batch = await marketContract.batchListings(listingId);
      // Stop checking if we hit empty records (unseeded sequential IDs)
      if (batch.seller === ZERO_ADDRESS) {
        break;
      }

      // Verify listing activity flag in BatchListings mapping
      if (batch.isActive) {
        const spawn = await managerContract.spawnLogs(Number(batch.spawnId));
        const batchSpeciesId = Number(spawn.speciesId);

        if (matchesSpecies(speciesId, batchSpeciesId)) {
          const species = await managerContract.speciesCatalog(batchSpeciesId);
          rows.push(buildBatchRow(listingId, batch, batchSpeciesId, species));
        }
      }
      listingId++;
    } catch (err) {
      console.warn(`Error reading batch listing for ID ${listingId}:`, err);
      break; // Out of bounds error
    }
  }
  return rows;
}

/**
 * Helper to fetch and filter active specimen and batch listings for a specific speciesId.
 * Verifies activity using the active status flags from Listings and BatchListings mappings.
 *
 * Reads go through Multicall3 (a handful of eth_calls for the whole scan) and
 * fall back to one eth_call per read when Multicall3 is unavailable.
 *
 * @param {object} [opts]
 * @param {import("ethers").Contract} [opts.multicall]  injected Multicall3 (tests)
 * @param {boolean} [opts.disableMulticall]  force the direct path (tests, live checks)
 */
export async function fetchListingsByBreed(speciesId, contractAddress, marketplaceAddress, provider, opts = {}) {
  if (!contractAddress || !marketplaceAddress || !provider) {
    return [];
  }

  const managerContract = new Contract(contractAddress, managerAbi, provider);
  const marketContract = new Contract(marketplaceAddress, marketplaceAbi, provider);
  const mcOpts = opts.multicall ? { multicall: opts.multicall } : {};
  const useMulticall = !opts.disableMulticall;

  const results = [];

  // 1. Fetch Active Individual Specimen Listings
  try {
    const totalSpecimens = Number(await managerContract.totalSpecimensMinted());
    const batched = useMulticall
      ? await readSpecimenListingsBatched(speciesId, managerContract, marketContract, totalSpecimens, mcOpts)
      : null;
    results.push(...(batched || await readSpecimenListingsDirect(speciesId, managerContract, marketContract, totalSpecimens)));
  } catch (err) {
    console.error("Error fetching specimen listings:", err);
  }

  // 2. Fetch Active Batch Listings
  try {
    const batched = useMulticall
      ? await readBatchListingsBatched(speciesId, managerContract, marketContract, mcOpts)
      : null;
    results.push(...(batched || await readBatchListingsDirect(speciesId, managerContract, marketContract)));
  } catch (err) {
    console.error("Error fetching batch listings:", err);
  }

  return results;
}
