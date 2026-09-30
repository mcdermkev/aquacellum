/**
 * scanEscrowOrders (CheckoutSummary's My Orders scan) and
 * readSpawnLogsForSpecies (HatcheryLogs' timeline) read through Multicall3 and
 * must return exactly what the one-call-per-read paths return. Same approach
 * as listingManager.multicall.test.js: a fake provider plays the chain,
 * answering direct AquadexManager / AquadexMarketplace calls from in-memory
 * tables and also executing Multicall3.aggregate3 against the same tables, so
 * both paths run the real ethers encoding and the test can count eth_calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Contract, utils } from "ethers";
import managerAbi from "../abi/AquadexManager.json";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { MULTICALL3_ADDRESS } from "../services/contractCatalogReader";
import { scanEscrowOrders, BATCH_PURCHASE_SCAN } from "../services/orderEscrowScan";
import { readSpawnLogsForSpecies, SPAWN_LOG_WINDOW } from "../services/spawnLogScan";

const MANAGER = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
const MARKET = "0x0741D50d49e7374b855b532c17aD36aBF8AF3b3e";
// Checksummed, as ethers decodes them.
const WALLET = utils.getAddress("0x00000000000000000000000000000000000000aa");
const OTHER_A = utils.getAddress("0x00000000000000000000000000000000000000b1");
const OTHER_B = utils.getAddress("0x00000000000000000000000000000000000000c2");
const ZERO = "0x0000000000000000000000000000000000000000";

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
    if (o.type === "address") return ZERO;
    if (o.type === "bytes") return "0x";
    if (/^bytes\d+$/.test(o.type)) return utils.hexZeroPad("0x", Number(o.type.slice(5)));
    return 0;
  });
  return ifc.encodeFunctionResult(fnName, values);
}

const SPECIES = {
  1: { speciesId: 1, scientificName: "Oryzias latipes", commonName: "Medaka", active: true },
  2: { speciesId: 2, scientificName: "Betta splendens", commonName: "Betta", active: true },
};

const eth = (s) => utils.parseEther(s);

/**
 * Build a chain. `reverts` is a set of "fn:id" keys whose read reverts.
 * Unset mapping keys return the zero struct, as Solidity public mappings do.
 * `spawnToListing` maps spawnId -> listingId (single uint256 output).
 */
function makeChain(tables = {}, reverts = new Set()) {
  const all = { speciesCatalog: SPECIES, ...tables };
  function answer(to, data) {
    const addr = to.toLowerCase();
    const ifc = addr === MANAGER.toLowerCase() ? managerIface : addr === MARKET.toLowerCase() ? marketIface : null;
    if (!ifc) return { success: false, returnData: "0x" };
    const tx = ifc.parseTransaction({ data });
    const id = tx.args.length ? Number(tx.args[0]) : null;
    if (reverts.has(`${tx.name}:${id}`)) return { success: false, returnData: "0x" };
    if (tx.name === "spawnToListing") {
      return { success: true, returnData: ifc.encodeFunctionResult(tx.name, [(all.spawnToListing || {})[id] || 0]) };
    }
    if (!(tx.name in all)) return { success: false, returnData: "0x" };
    return { success: true, returnData: encodeResult(ifc, tx.name, all[tx.name][id] || {}) };
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

const contractsFor = (chain) => ({
  managerContract: new Contract(MANAGER, managerAbi, chain),
  marketContract: new Contract(MARKET, marketplaceAbi, chain),
});

async function measure(chain, run) {
  chain.calls.length = 0;
  const result = await run();
  return { result, calls: chain.calls.length };
}

// ─── Escrow orders (CheckoutSummary) ─────────────────────────────────────────

const TOTAL_SPECIMENS = 25; // > the direct path's 10-id rounds

const escrowChain = () => makeChain(
  {
    shippingEscrows: {
      1: { tokenId: 1, buyer: WALLET, seller: OTHER_A, price: eth("0.5"), shippingFee: eth("0.01"), amountLocked: eth("0.51"), trackingNumber: "1Z999", dispatchTimestamp: 1700000500, status: 1 },
      2: { tokenId: 2, buyer: OTHER_A, seller: WALLET, price: eth("1"), amountLocked: eth("1"), status: 0 },
      3: { tokenId: 3, buyer: OTHER_A, seller: OTHER_B, price: eth("2"), amountLocked: eth("2"), status: 2 }, // curator only
      5: { tokenId: 5, buyer: WALLET, seller: OTHER_B, price: eth("3") }, // specimens(5) reverts
      6: { tokenId: 6, buyer: WALLET, seller: OTHER_B, price: eth("0.25"), amountLocked: eth("0.25"), status: 3 },
      17: { tokenId: 17, buyer: OTHER_B, seller: WALLET, price: eth("0.75"), amountLocked: eth("0.75"), status: 1 },
    },
    specimens: {
      1: { specimenId: 1, speciesId: 1 },
      2: { specimenId: 2, speciesId: 1 },
      3: { specimenId: 3, speciesId: 2 },
      6: { specimenId: 6, speciesId: 2 },
      17: { specimenId: 17, speciesId: 2 },
    },
    escrowPurchases: {
      1: { purchaseId: 1, listingId: 1, buyer: WALLET, quantity: 3, amountLocked: eth("0.3"), state: 1, fulfillmentType: 0 },
      2: { purchaseId: 2, listingId: 2, buyer: OTHER_A, quantity: 1, amountLocked: eth("0.1"), state: 0, fulfillmentType: 1 },
      3: { purchaseId: 3, listingId: 3, buyer: OTHER_A, quantity: 2, amountLocked: eth("0.2"), state: 2, fulfillmentType: 1 }, // curator only
      4: { purchaseId: 4, listingId: 4, buyer: WALLET, quantity: 5, amountLocked: eth("0.5"), state: 1, fulfillmentType: 1 }, // spawnRecords reverts
      5: { purchaseId: 5, listingId: 99, buyer: WALLET, quantity: 1 }, // batchListings(99) reverts
      // 6 is empty: the purchase scan is a fixed range, not a walk
      7: { purchaseId: 7, listingId: 1, buyer: WALLET, quantity: 1, amountLocked: eth("0.1"), state: 3, fulfillmentType: 0 },
      48: { purchaseId: 48, listingId: 2, buyer: OTHER_B, quantity: 4, amountLocked: eth("0.4"), state: 1, fulfillmentType: 1 },
    },
    batchListings: {
      1: { listingId: 1, spawnId: 10, quantity: 9, pricePerFish: 100, seller: OTHER_B, isActive: true },
      2: { listingId: 2, spawnId: 12, quantity: 4, pricePerFish: 100, seller: WALLET, isActive: true },
      3: { listingId: 3, spawnId: 10, quantity: 1, pricePerFish: 100, seller: OTHER_B, isActive: false },
      4: { listingId: 4, spawnId: 13, quantity: 1, pricePerFish: 100, seller: OTHER_A, isActive: true },
    },
    spawnRecords: {
      10: { spawnId: 10, sireId: 1 },
      12: { spawnId: 12, sireId: 6 },
    },
  },
  new Set(["specimens:5", "batchListings:99", "spawnRecords:13"]),
);

const escrowDirect = (chain, isCurator = false) => measure(chain, () =>
  scanEscrowOrders({ ...contractsFor(chain), walletAccount: WALLET.toLowerCase(), isCurator, totalSpecimens: TOTAL_SPECIMENS }, { disableMulticall: true }));

const escrowBatched = (chain, isCurator = false) => measure(chain, () =>
  scanEscrowOrders({ ...contractsFor(chain), walletAccount: WALLET.toLowerCase(), isCurator, totalSpecimens: TOTAL_SPECIMENS }));

describe("scanEscrowOrders via Multicall3", () => {
  let warn;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  it("returns the same rows as the direct path, in far fewer calls", async () => {
    const chain = escrowChain();
    const d = await escrowDirect(chain);
    const b = await escrowBatched(chain);
    expect(d.result.shipping.map((r) => r.tokenId)).toEqual([1, 2, 6, 17]);
    expect(d.result.purchases.map((r) => r.purchaseId)).toEqual([1, 2, 4, 7, 48]);
    expect(b.result).toEqual(d.result);
    // shippingEscrows + specimens + speciesCatalog
    // + escrowPurchases + batchListings + spawnRecords + specimens + speciesCatalog
    expect(b.calls).toBe(8);
    expect(d.calls).toBeGreaterThan(b.calls * 10);
  });

  it("includes every party's rows for the curator, identically", async () => {
    const chain = escrowChain();
    const d = await escrowDirect(chain, true);
    const b = await escrowBatched(chain, true);
    expect(d.result.shipping.map((r) => r.tokenId)).toEqual([1, 2, 3, 6, 17]);
    expect(d.result.purchases.map((r) => r.purchaseId)).toEqual([1, 2, 3, 4, 7, 48]);
    expect(b.result).toEqual(d.result);
  });

  it("keeps the exact row shape (spot check)", async () => {
    const { result } = await escrowBatched(escrowChain());
    expect(result.shipping[0]).toEqual({
      tokenId: 1, buyer: WALLET, seller: OTHER_A, price: "0.5", shippingFee: "0.01", amountLocked: "0.51",
      trackingNumber: "1Z999", dispatchTimestamp: 1700000500, status: 1, commonName: "Medaka", role: "Buyer",
    });
    expect(result.shipping[1].role).toBe("Seller");
    expect(result.purchases[0]).toEqual({
      purchaseId: 1, listingId: 1, buyer: WALLET, seller: OTHER_B, quantity: 3, amountLocked: "0.3",
      state: 1, fulfillmentType: 0, commonName: "Medaka Fry", role: "Buyer",
    });
    // spawn 12's sire is specimen 6 (Betta); spawnRecords(13) reverts -> generic name
    expect(result.purchases.find((r) => r.purchaseId === 2)).toMatchObject({ commonName: "Betta Fry", role: "Seller" });
    expect(result.purchases.find((r) => r.purchaseId === 4).commonName).toBe("Juvenile Fry Batch");
  });

  it("falls back to the direct path when Multicall3 is unavailable", async () => {
    const chain = escrowChain();
    const d = await escrowDirect(chain);
    chain.multicallAvailable = false;
    const b = await escrowBatched(chain);
    expect(b.result).toEqual(d.result);
    expect(b.calls).toBe(d.calls + 2); // one failed aggregate3 per scan
  });

  it("returns empty lists when nothing is on chain", async () => {
    const chain = makeChain();
    const b = await escrowBatched(chain);
    expect(b.result).toEqual({ shipping: [], purchases: [] });
    expect(b.calls).toBe(2);
    expect(BATCH_PURCHASE_SCAN).toBe(50);
  });
});

// ─── Spawn logs (HatcheryLogs) ───────────────────────────────────────────────

// A species-1 spawn in the second spawnLogs window (ids divisible by 3 are species 2).
const SECOND_WINDOW_SPAWN = SPAWN_LOG_WINDOW % 3 === 2 ? SPAWN_LOG_WINDOW + 2 : SPAWN_LOG_WINDOW + 1;

function spawnChain({ n = SPAWN_LOG_WINDOW + 5, reverts = [] } = {}) {
  const spawnLogs = {};
  for (let id = 1; id <= n; id++) {
    spawnLogs[id] = {
      spawnId: id, speciesId: (id % 3 === 0) ? 2 : 1, breeder: id % 2 ? OTHER_A : OTHER_B,
      eggCount: 10 + id, eventTimestamp: 1700000000 + id * 60, notesIpfsHash: `Qm${id}`,
    };
  }
  // A record after the gap must not be picked up, matching the direct walk.
  spawnLogs[n + 2] = { spawnId: n + 2, speciesId: 1, breeder: OTHER_A, eggCount: 1, eventTimestamp: 1 };
  return makeChain(
    {
      spawnLogs,
      spawnToListing: { 1: 1, 2: 2, 3: 3, 4: 4, 7: 5, [SECOND_WINDOW_SPAWN]: 6 },
      batchListings: {
        1: { listingId: 1, spawnId: 1, quantity: 5, pricePerFish: 2500, seller: OTHER_A, isActive: true },
        2: { listingId: 2, spawnId: 2, quantity: 3, pricePerFish: 1500, seller: OTHER_B, isActive: false },
        3: { listingId: 3, spawnId: 3, quantity: 8, pricePerFish: 900, seller: OTHER_A, isActive: true },
        5: { listingId: 5, spawnId: 7, quantity: 2, pricePerFish: 1200, seller: OTHER_A, isActive: true },
        6: { listingId: 6, spawnId: SECOND_WINDOW_SPAWN, quantity: 1, pricePerFish: 700, seller: OTHER_B, isActive: true },
      },
    },
    // spawnToListing(5) and batchListings(4) revert: logged, listing stays null.
    new Set(["spawnToListing:5", "batchListings:4", ...reverts]),
  );
}

const logsDirect = (chain, specCode, withMarket = true) => measure(chain, () => {
  const { managerContract, marketContract } = contractsFor(chain);
  return readSpawnLogsForSpecies(managerContract, withMarket ? marketContract : null, specCode, { disableMulticall: true });
});

const logsBatched = (chain, specCode, withMarket = true) => measure(chain, () => {
  const { managerContract, marketContract } = contractsFor(chain);
  return readSpawnLogsForSpecies(managerContract, withMarket ? marketContract : null, specCode);
});

describe("readSpawnLogsForSpecies via Multicall3", () => {
  let warn;
  let error;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { warn.mockRestore(); error.mockRestore(); });

  it("walks across windows, stops at the first empty record, and matches the direct path", async () => {
    const chain = spawnChain();
    const n = SPAWN_LOG_WINDOW + 5;
    for (const sp of [1, 2, 99]) {
      const d = await logsDirect(chain, sp);
      const b = await logsBatched(chain, sp);
      expect(b.result).toEqual(d.result);
      expect(b.result.map((r) => r.spawnId)).not.toContain(n + 2);
    }
    const d = await logsDirect(chain, 1);
    const b = await logsBatched(chain, 1);
    expect(b.result.length).toBe(Array.from({ length: n }, (_, k) => k + 1).filter((id) => id % 3 !== 0).length);
    // 2 spawnLogs windows + spawnToListing + batchListings
    expect(b.calls).toBe(4);
    expect(d.calls).toBeGreaterThan(b.calls * 10);
  });

  it("keeps the exact row shape and listing details (spot check)", async () => {
    const { result } = await logsBatched(spawnChain(), 1);
    expect(result[0]).toEqual({
      spawnId: 1, speciesId: 1, breeder: OTHER_A, eggCount: 11, eventTimestamp: 1700000060, notesIpfsHash: "Qm1",
      listing: { listingId: 1, spawnId: 1, quantity: 5, pricePerFish: "2500", seller: OTHER_A, isActive: true },
    });
    const byId = Object.fromEntries(result.map((r) => [r.spawnId, r.listing]));
    expect(byId[2]).toBeNull(); // inactive listing
    expect(byId[4]).toBeNull(); // batchListings(4) reverts
    expect(byId[5]).toBeNull(); // spawnToListing(5) reverts
    expect(byId[7]).toMatchObject({ listingId: 5, pricePerFish: "1200" });
    expect(byId[SECOND_WINDOW_SPAWN]).toMatchObject({ listingId: 6 });
  });

  it("matches the direct path without a marketplace contract", async () => {
    const chain = spawnChain();
    const d = await logsDirect(chain, 1, false);
    const b = await logsBatched(chain, 1, false);
    expect(b.result).toEqual(d.result);
    expect(b.result.every((r) => r.listing === null)).toBe(true);
    expect(b.calls).toBe(2);
  });

  it("stops the walk at a failed spawnLogs read exactly like the direct path", async () => {
    const chain = spawnChain({ reverts: ["spawnLogs:6"] });
    const d = await logsDirect(chain, 1);
    const b = await logsBatched(chain, 1);
    expect(d.result.map((r) => r.spawnId)).toEqual([1, 2, 4, 5]);
    expect(b.result).toEqual(d.result);
  });

  it("falls back to the direct path when Multicall3 is unavailable", async () => {
    const chain = spawnChain();
    const d = await logsDirect(chain, 2);
    chain.multicallAvailable = false;
    const b = await logsBatched(chain, 2);
    expect(b.result).toEqual(d.result);
    expect(b.calls).toBe(d.calls + 1);
  });

  it("returns [] with no contract or no logs", async () => {
    expect(await readSpawnLogsForSpecies(null, null, 1)).toEqual([]);
    const chain = makeChain();
    const b = await logsBatched(chain, 1);
    expect(b.result).toEqual([]);
    expect(b.calls).toBe(1);
  });
});
