/**
 * fetchListingsByBreed reads through Multicall3 and must return exactly what
 * the one-call-per-read path returns. A fake provider plays the chain: it
 * answers AquadexManager / AquadexMarketplace calls from in-memory tables and
 * also executes Multicall3.aggregate3 against the same tables, so both paths
 * run the real ethers encoding and the test can count eth_calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { utils } from "ethers";
import managerAbi from "../abi/AquadexManager.json";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { fetchListingsByBreed, BATCH_LISTING_WINDOW } from "../utils/listingManager";
import { MULTICALL3_ADDRESS } from "../services/contractCatalogReader";

const MANAGER = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
const MARKET = "0x0741D50d49e7374b855b532c17aD36aBF8AF3b3e";
const SELLER_A = "0x00000000000000000000000000000000000000A1";
const SELLER_B = "0x00000000000000000000000000000000000000b2";

const managerIface = new utils.Interface(managerAbi);
const marketIface = new utils.Interface(marketplaceAbi);
const multicallIface = new utils.Interface([
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)",
]);

function encodeResult(ifc, fnName, overrides = {}) {
  const fn = ifc.getFunction(fnName);
  const values = fn.outputs.map((o) => {
    if (o.name && o.name in overrides) return overrides[o.name];
    if (o.type === "string") return "";
    if (o.type === "bool") return false;
    if (o.type === "address") return "0x0000000000000000000000000000000000000000";
    return 0;
  });
  return ifc.encodeFunctionResult(fnName, values);
}

const SPECIES = {
  1: { speciesId: 1, scientificName: "Oryzias latipes", commonName: "Medaka", careLevel: 1, minTempCelsiusX10: 180, maxTempCelsiusX10: 280, minPhX10: 65, maxPhX10: 80, active: true },
  2: { speciesId: 2, scientificName: "Betta splendens", commonName: "Betta", careLevel: 2, minTempCelsiusX10: 240, maxTempCelsiusX10: 300, minPhX10: 60, maxPhX10: 75, active: true },
};

/**
 * Build a chain. `reverts` is a set of "fn:id" keys whose read reverts.
 * Unset mapping keys return the zero struct, as Solidity public mappings do.
 */
function makeChain({ listings = {}, specimens = {}, batchListings = {}, spawnLogs = {}, totalSpecimens = 0, reverts = new Set() } = {}) {
  function answer(to, data) {
    const addr = to.toLowerCase();
    const ifc = addr === MANAGER.toLowerCase() ? managerIface : addr === MARKET.toLowerCase() ? marketIface : null;
    if (!ifc) return { success: false, returnData: "0x" };
    const tx = ifc.parseTransaction({ data });
    const id = tx.args.length ? Number(tx.args[0]) : null;
    if (reverts.has(`${tx.name}:${id}`)) return { success: false, returnData: "0x" };
    const tables = { listings, specimens, batchListings, spawnLogs, speciesCatalog: SPECIES };
    if (tx.name === "totalSpecimensMinted") {
      return { success: true, returnData: ifc.encodeFunctionResult(tx.name, [totalSpecimens]) };
    }
    if (!(tx.name in tables)) return { success: false, returnData: "0x" };
    return { success: true, returnData: encodeResult(ifc, tx.name, tables[tx.name][id] || {}) };
  }

  const calls = [];
  const provider = {
    _isProvider: true,
    multicallAvailable: true,
    calls,
    async call(tx) {
      const to = tx.to.toLowerCase();
      calls.push(to);
      if (to === MULTICALL3_ADDRESS.toLowerCase()) {
        if (!provider.multicallAvailable) throw new Error("call revert exception");
        const [subCalls] = multicallIface.decodeFunctionData("aggregate3", tx.data);
        const out = subCalls.map((c) => {
          const r = answer(c.target, c.callData);
          if (!r.success && !c.allowFailure) throw new Error("Multicall3: call failed");
          return [r.success, r.returnData];
        });
        return multicallIface.encodeFunctionResult("aggregate3", [out]);
      }
      const r = answer(tx.to, tx.data);
      if (!r.success) {
        const err = new Error("call revert exception");
        err.code = "CALL_EXCEPTION";
        throw err;
      }
      return r.returnData;
    },
  };
  return provider;
}

const standardChain = () => makeChain({
  totalSpecimens: 8,
  listings: {
    1: { tokenId: 1, seller: SELLER_A, price: 1250, shippingFee: 900, active: true, isShipping: true },
    2: { tokenId: 2, seller: SELLER_A, price: 500, active: false },
    3: { tokenId: 3, seller: SELLER_B, price: 2000, shippingFee: 0, active: true, isShipping: false },
    5: { tokenId: 5, seller: SELLER_B, price: 799, shippingFee: 450, active: true, isShipping: true },
    6: { tokenId: 6, seller: SELLER_A, price: 100, active: true },
    8: { tokenId: 8, seller: SELLER_A, price: 333, active: true },
  },
  specimens: {
    1: { specimenId: 1, speciesId: 1, birthTimestamp: 1700000000, sireId: 0, damId: 0, ipfsMetadataUri: "ipfs://a" },
    3: { specimenId: 3, speciesId: 2, birthTimestamp: 1700000100, sireId: 1, damId: 2, ipfsMetadataUri: "ipfs://b" },
    5: { specimenId: 5, speciesId: 1, birthTimestamp: 1700000200, sireId: 1, damId: 0, ipfsMetadataUri: "" },
    8: { specimenId: 8, speciesId: 2, birthTimestamp: 1700000300, ipfsMetadataUri: "ipfs://c" },
  },
  batchListings: {
    1: { listingId: 1, spawnId: 10, quantity: 4, pricePerFish: 300, seller: SELLER_A, isActive: true },
    2: { listingId: 2, spawnId: 11, quantity: 0, pricePerFish: 250, seller: SELLER_B, isActive: false },
    3: { listingId: 3, spawnId: 12, quantity: 7, pricePerFish: 450, seller: SELLER_B, isActive: true },
  },
  spawnLogs: {
    10: { spawnId: 10, speciesId: 1 },
    11: { spawnId: 11, speciesId: 2 },
    12: { spawnId: 12, speciesId: 2 },
  },
  // specimens(6) reverts: the direct path warns and skips token 6.
  reverts: new Set(["specimens:6"]),
});

async function direct(chain, speciesId = null) {
  chain.calls.length = 0;
  const rows = await fetchListingsByBreed(speciesId, MANAGER, MARKET, chain, { disableMulticall: true });
  return { rows, calls: chain.calls.length };
}

async function batched(chain, speciesId = null) {
  chain.calls.length = 0;
  const rows = await fetchListingsByBreed(speciesId, MANAGER, MARKET, chain);
  return { rows, calls: chain.calls.length };
}

describe("fetchListingsByBreed via Multicall3", () => {
  let warn;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  it("returns the same rows as the direct path for all species, in far fewer calls", async () => {
    const chain = standardChain();
    const d = await direct(chain);
    const b = await batched(chain);
    expect(d.rows.map((r) => `${r.isBatch ? "b" : "s"}${r.id}`)).toEqual(["s1", "s3", "s5", "s8", "b1", "b3"]);
    expect(b.rows).toEqual(d.rows);
    // 1 totalSpecimensMinted + listings + specimens + speciesCatalog
    // + batchListings window + spawnLogs + speciesCatalog
    expect(b.calls).toBe(7);
    expect(d.calls).toBeGreaterThan(b.calls * 3);
  });

  it("keeps the exact row shape (spot check)", async () => {
    const { rows } = await batched(standardChain());
    expect(rows[0]).toEqual({
      id: 1, tokenId: 1, seller: SELLER_A, price: "12.50", priceUsd: "12.50", priceCentsUSD: 1250,
      rawPrice: "12.50", shippingFee: "9.00", shippingFeeCents: 900, isShipping: true, speciesId: 1,
      commonName: "Medaka", scientificName: "Oryzias latipes", sireId: 0, damId: 0, ipfsMetadataUri: "ipfs://a",
      birthTimestamp: 1700000000, careLevel: 1, minTemp: 18, maxTemp: 28, minPh: 6.5, maxPh: 8, isBatch: false,
    });
    const batch = rows.find((r) => r.isBatch && r.id === 3);
    expect(batch).toEqual({
      id: 3, listingId: 3, spawnId: 12, quantity: 7, price: "4.50", priceUsd: "4.50", priceCentsUSD: 450,
      pricePerFishCents: 450, rawPrice: "4.50", seller: SELLER_B, isActive: true, speciesId: 2,
      commonName: "Betta Fry Batch", scientificName: "Betta splendens", careLevel: 2, minTemp: 24, maxTemp: 30,
      minPh: 6, maxPh: 7.5, isBatch: true, isShipping: false, shippingFee: "0",
    });
  });

  it("filters by species identically", async () => {
    const chain = standardChain();
    for (const sp of [1, 2, 99]) {
      const d = await direct(chain, sp);
      const b = await batched(chain, sp);
      expect(b.rows).toEqual(d.rows);
    }
    expect((await batched(chain, 2)).rows.map((r) => r.id)).toEqual([3, 8, 3]);
  });

  it("falls back to the direct path when Multicall3 is unavailable", async () => {
    const chain = standardChain();
    const d = await direct(chain);
    chain.multicallAvailable = false;
    const b = await batched(chain);
    expect(b.rows).toEqual(d.rows);
  });

  it("walks batch listings across windows and stops at the first empty record", async () => {
    const n = BATCH_LISTING_WINDOW + 3;
    const batchListings = {};
    const spawnLogs = {};
    for (let id = 1; id <= n; id++) {
      batchListings[id] = { listingId: id, spawnId: 100 + id, quantity: id, pricePerFish: 100 + id, seller: SELLER_A, isActive: id % 2 === 1 };
      spawnLogs[100 + id] = { spawnId: 100 + id, speciesId: (id % 2) + 1 };
    }
    // A record after the gap must not be picked up, matching the direct walk.
    batchListings[n + 2] = { listingId: n + 2, spawnId: 101, quantity: 1, pricePerFish: 1, seller: SELLER_B, isActive: true };
    const chain = makeChain({ batchListings, spawnLogs });
    const d = await direct(chain);
    const b = await batched(chain);
    expect(b.rows).toEqual(d.rows);
    expect(b.rows.map((r) => r.id)).not.toContain(n + 2);
    expect(b.rows.length).toBe(Math.ceil(n / 2));
    // totalSpecimensMinted + 2 batchListings windows + spawnLogs + speciesCatalog
    expect(b.calls).toBe(5);
  });

  it("stops the batch walk at a failed read exactly like the direct path", async () => {
    // One failing read per run: the walk itself, a spawn lookup, a species lookup.
    const expectedIds = { "batchListings:2": [1], "spawnLogs:10": [], "speciesCatalog:2": [1] };
    for (const key of Object.keys(expectedIds)) {
      const chain = makeChain({
        batchListings: {
          1: { listingId: 1, spawnId: 10, quantity: 4, pricePerFish: 300, seller: SELLER_A, isActive: true },
          2: { listingId: 2, spawnId: 11, quantity: 2, pricePerFish: 250, seller: SELLER_B, isActive: true },
          3: { listingId: 3, spawnId: 12, quantity: 7, pricePerFish: 450, seller: SELLER_B, isActive: true },
        },
        spawnLogs: { 10: { spawnId: 10, speciesId: 1 }, 11: { spawnId: 11, speciesId: 2 }, 12: { spawnId: 12, speciesId: 1 } },
        reverts: new Set([key]),
      });
      const d = await direct(chain);
      const b = await batched(chain);
      expect(d.rows.map((r) => r.id)).toEqual(expectedIds[key]);
      expect(b.rows).toEqual(d.rows);
    }
  });

  it("returns [] without calling out when addresses or provider are missing", async () => {
    expect(await fetchListingsByBreed(null, MANAGER, MARKET, null)).toEqual([]);
    expect(await fetchListingsByBreed(null, "", MARKET, standardChain())).toEqual([]);
  });
});
