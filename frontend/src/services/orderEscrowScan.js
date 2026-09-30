/**
 * orderEscrowScan.js: the on-chain half of the My Orders tab (CheckoutSummary).
 *
 * Two scans, both filtered to rows the wallet is party to (or every row for
 * the curator):
 *   - shippingEscrows(1..totalSpecimens), plus specimens + speciesCatalog for
 *     the matches (the species common name);
 *   - escrowPurchases(1..BATCH_PURCHASE_SCAN), plus batchListings for the
 *     seller and spawnRecords -> specimens(sire) -> speciesCatalog for the
 *     "<species> Fry" name.
 *
 * Issued one by one this was 1 + 3 per match per specimen id plus up to 5 per
 * purchase id, which the public Base Sepolia RPC answers with HTTP 429. Each
 * scan goes through Multicall3 (a handful of eth_calls in total) and falls
 * back to the original per-call reads when Multicall3 is unavailable. Both
 * paths share the row builders below, so they return identical objects in
 * the same order.
 */
import { utils } from "ethers";
import { multicallRead } from "./contractCatalogReader";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** escrowPurchases ids scanned (the marketplace has no purchase counter getter). */
export const BATCH_PURCHASE_SCAN = 50;

/** Specimen ids read concurrently per round on the direct path. */
const DIRECT_SHIPPING_CONCURRENCY = 10;

const DEFAULT_FRY_NAME = "Juvenile Fry Batch";

const sameAddress = (a, walletAccount) => a.toLowerCase() === walletAccount.toLowerCase();

const roleOf = (isBuyer, isSeller) => (isBuyer ? "Buyer" : isSeller ? "Seller" : "Curator");

// ─── Row builders (shared by the Multicall3 and direct paths) ────────────────

function buildShippingRow(tokenId, esc, species, isBuyer, isSeller) {
  return {
    tokenId,
    buyer: esc.buyer,
    seller: esc.seller,
    price: utils.formatEther(esc.price),
    shippingFee: utils.formatEther(esc.shippingFee),
    amountLocked: utils.formatEther(esc.amountLocked),
    trackingNumber: esc.trackingNumber,
    dispatchTimestamp: Number(esc.dispatchTimestamp),
    status: Number(esc.status),
    commonName: species.commonName,
    role: roleOf(isBuyer, isSeller),
  };
}

function buildPurchaseRow(purchaseId, purch, listing, commonName, isBuyer, isSeller) {
  return {
    purchaseId,
    listingId: Number(purch.listingId),
    buyer: purch.buyer,
    seller: listing.seller,
    quantity: Number(purch.quantity),
    amountLocked: utils.formatEther(purch.amountLocked),
    state: Number(purch.state),
    fulfillmentType: Number(purch.fulfillmentType),
    commonName,
    role: roleOf(isBuyer, isSeller),
  };
}

/** spawnRecords.sireId, defaulting to specimen 1 as the original lookup did. */
const sireIdOf = (spawnRec) => Number(spawnRec.sireId || 1);

/** Map each distinct key to its multicall value. null when Multicall3 is unavailable. */
async function readDistinct(contract, fnName, keys, mcOpts) {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return new Map();
  const values = await multicallRead(contract, fnName, unique.map((k) => [k]), mcOpts);
  if (!values) return null;
  return new Map(unique.map((k, i) => [k, values[i]]));
}

// ─── Shipping escrows ────────────────────────────────────────────────────────

/**
 * Multicall3 path: shippingEscrows(1..N), then specimens(matches), then
 * speciesCatalog(distinct species). About 3 requests instead of N + 2 per
 * match. Returns null so the caller falls back to the direct path.
 */
async function readShippingBatched({ managerContract, marketContract, walletAccount, isCurator, totalSpecimens }, mcOpts) {
  const ids = [];
  for (let i = 1; i <= totalSpecimens; i++) ids.push(i);

  const escrows = await multicallRead(marketContract, "shippingEscrows", ids.map((i) => [i]), mcOpts);
  if (!escrows) return null;

  const matching = [];
  ids.forEach((tokenId, k) => {
    const esc = escrows[k];
    if (!esc || esc.buyer === ZERO_ADDRESS) return;
    const isBuyer = sameAddress(esc.buyer, walletAccount);
    const isSeller = sameAddress(esc.seller, walletAccount);
    if (!isBuyer && !isSeller && !isCurator) return;
    matching.push({ tokenId, esc, isBuyer, isSeller });
  });
  if (matching.length === 0) return [];

  const specs = await multicallRead(managerContract, "specimens", matching.map(({ tokenId }) => [tokenId]), mcOpts);
  if (!specs) return null;

  const withSpec = [];
  matching.forEach((m, k) => { if (specs[k]) withSpec.push({ ...m, spec: specs[k] }); });

  const speciesMap = await readDistinct(managerContract, "speciesCatalog", withSpec.map(({ spec }) => Number(spec.speciesId)), mcOpts);
  if (!speciesMap) return null;

  const rows = [];
  for (const { tokenId, esc, spec, isBuyer, isSeller } of withSpec) {
    const species = speciesMap.get(Number(spec.speciesId));
    if (!species) continue;
    try {
      rows.push(buildShippingRow(tokenId, esc, species, isBuyer, isSeller));
    } catch {
      // Same as a failed read on the direct path: the row is skipped.
    }
  }
  return rows;
}

/** Direct path: one eth_call per read, DIRECT_SHIPPING_CONCURRENCY ids at a time. */
async function readShippingDirect({ managerContract, marketContract, walletAccount, isCurator, totalSpecimens }) {
  const rows = [];
  for (let start = 1; start <= totalSpecimens; start += DIRECT_SHIPPING_CONCURRENCY) {
    const end = Math.min(start + DIRECT_SHIPPING_CONCURRENCY - 1, totalSpecimens);
    const round = [];
    for (let i = start; i <= end; i++) {
      round.push(
        (async (tokenId) => {
          try {
            const esc = await marketContract.shippingEscrows(tokenId);
            if (esc.buyer === ZERO_ADDRESS) return null;
            const isBuyer = sameAddress(esc.buyer, walletAccount);
            const isSeller = sameAddress(esc.seller, walletAccount);
            if (!isBuyer && !isSeller && !isCurator) return null;

            const spec = await managerContract.specimens(tokenId);
            const species = await managerContract.speciesCatalog(Number(spec.speciesId));
            return buildShippingRow(tokenId, esc, species, isBuyer, isSeller);
          } catch {
            return null;
          }
        })(i)
      );
    }
    const results = await Promise.allSettled(round);
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) rows.push(r.value);
    }
  }
  return rows;
}

// ─── Batch (fry) escrow purchases ────────────────────────────────────────────

/**
 * Multicall3 path: escrowPurchases(1..50), batchListings(distinct listings),
 * then the name chain spawnRecords -> specimens(sire) -> speciesCatalog, one
 * request per step. A failed name read falls back to "Juvenile Fry Batch",
 * exactly as on the direct path. Returns null so the caller falls back.
 */
async function readPurchasesBatched({ managerContract, marketContract, walletAccount, isCurator }, mcOpts) {
  const ids = [];
  for (let i = 1; i <= BATCH_PURCHASE_SCAN; i++) ids.push(i);

  const purchases = await multicallRead(marketContract, "escrowPurchases", ids.map((i) => [i]), mcOpts);
  if (!purchases) return null;

  const found = [];
  ids.forEach((purchaseId, k) => {
    const purch = purchases[k];
    if (!purch || purch.buyer === ZERO_ADDRESS) return;
    found.push({ purchaseId, purch });
  });
  if (found.length === 0) return [];

  const listingMap = await readDistinct(marketContract, "batchListings", found.map(({ purch }) => Number(purch.listingId)), mcOpts);
  if (!listingMap) return null;

  const matching = [];
  for (const { purchaseId, purch } of found) {
    const listing = listingMap.get(Number(purch.listingId));
    if (!listing) continue;
    const isBuyer = sameAddress(purch.buyer, walletAccount);
    const isSeller = sameAddress(listing.seller, walletAccount);
    if (!isBuyer && !isSeller && !isCurator) continue;
    matching.push({ purchaseId, purch, listing, isBuyer, isSeller });
  }
  if (matching.length === 0) return [];

  const spawnMap = await readDistinct(managerContract, "spawnRecords", matching.map(({ listing }) => Number(listing.spawnId)), mcOpts);
  if (!spawnMap) return null;

  const sireIds = [];
  for (const { listing } of matching) {
    const spawnRec = spawnMap.get(Number(listing.spawnId));
    if (spawnRec) sireIds.push(sireIdOf(spawnRec));
  }
  const sireMap = await readDistinct(managerContract, "specimens", sireIds, mcOpts);
  if (!sireMap) return null;

  const speciesIds = [];
  for (const sireSpec of sireMap.values()) if (sireSpec) speciesIds.push(Number(sireSpec.speciesId));
  const speciesMap = await readDistinct(managerContract, "speciesCatalog", speciesIds, mcOpts);
  if (!speciesMap) return null;

  const rows = [];
  for (const { purchaseId, purch, listing, isBuyer, isSeller } of matching) {
    let commonName = DEFAULT_FRY_NAME;
    const spawnRec = spawnMap.get(Number(listing.spawnId));
    const sireSpec = spawnRec ? sireMap.get(sireIdOf(spawnRec)) : null;
    const species = sireSpec ? speciesMap.get(Number(sireSpec.speciesId)) : null;
    if (species) commonName = `${species.commonName} Fry`;
    try {
      rows.push(buildPurchaseRow(purchaseId, purch, listing, commonName, isBuyer, isSeller));
    } catch {
      // Same as a failed read on the direct path: the row is skipped.
    }
  }
  return rows;
}

/** Direct path: one eth_call per read, all purchase ids concurrently. */
async function readPurchasesDirect({ managerContract, marketContract, walletAccount, isCurator }) {
  const pending = [];
  for (let i = 1; i <= BATCH_PURCHASE_SCAN; i++) {
    pending.push(
      (async (purchaseId) => {
        try {
          const purch = await marketContract.escrowPurchases(purchaseId);
          if (purch.buyer === ZERO_ADDRESS) return null;
          const isBuyer = sameAddress(purch.buyer, walletAccount);

          const listing = await marketContract.batchListings(purch.listingId);
          const isSeller = sameAddress(listing.seller, walletAccount);

          if (!isBuyer && !isSeller && !isCurator) return null;

          let commonName = DEFAULT_FRY_NAME;
          try {
            const spawnRec = await managerContract.spawnRecords(listing.spawnId);
            const sireSpec = await managerContract.specimens(sireIdOf(spawnRec));
            const species = await managerContract.speciesCatalog(Number(sireSpec.speciesId));
            commonName = `${species.commonName} Fry`;
          } catch {
            // Keep the generic name.
          }

          return buildPurchaseRow(purchaseId, purch, listing, commonName, isBuyer, isSeller);
        } catch {
          return null;
        }
      })(i)
    );
  }
  const rows = [];
  const results = await Promise.allSettled(pending);
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) rows.push(r.value);
  }
  return rows;
}

/**
 * Read the wallet's shipping escrows and batch escrow purchases from chain.
 *
 * @param {object} params
 * @param {import("ethers").Contract} params.managerContract  AquadexManager (provider-connected)
 * @param {import("ethers").Contract} params.marketContract  AquadexMarketplace (provider-connected)
 * @param {string} params.walletAccount  viewer address
 * @param {boolean} params.isCurator  include every row regardless of party
 * @param {number} params.totalSpecimens  highest specimen id to scan
 * @param {object} [opts]
 * @param {import("ethers").Contract} [opts.multicall]  injected Multicall3 (tests)
 * @param {boolean} [opts.disableMulticall]  force the direct path (tests, live checks)
 * @returns {Promise<{shipping: object[], purchases: object[]}>}
 *   Rows in ascending id order, same shape on both paths.
 */
export async function scanEscrowOrders(params, opts = {}) {
  const mcOpts = opts.multicall ? { multicall: opts.multicall } : {};
  const useMulticall = !opts.disableMulticall;

  const tryBatched = async (read) => {
    if (!useMulticall) return null;
    try {
      return await read(params, mcOpts);
    } catch (err) {
      console.warn("[orderEscrowScan] Multicall3 path failed, falling back to single calls:", err?.message || err);
      return null;
    }
  };

  const shipping = (await tryBatched(readShippingBatched)) || await readShippingDirect(params);
  const purchases = (await tryBatched(readPurchasesBatched)) || await readPurchasesDirect(params);

  return { shipping, purchases };
}
