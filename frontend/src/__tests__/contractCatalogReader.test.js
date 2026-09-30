import { describe, it, expect, vi } from "vitest";
import { Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { readCatalogViaMulticall, multicallRead, MULTICALL_CHUNK } from "../services/contractCatalogReader";

const ADDRESS = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
const catalog = new Contract(ADDRESS, aquadexAbi);
const iface = catalog.interface;

const speciesFn = iface.getFunction("speciesCatalog");

/** Encode a speciesCatalog return value with every output zeroed except the named ones. */
function encodeSpecies(overrides) {
  const values = speciesFn.outputs.map((o) => {
    if (o.name in overrides) return overrides[o.name];
    if (o.type === "string") return "";
    if (o.type === "bool") return false;
    if (o.type === "address") return "0x0000000000000000000000000000000000000000";
    return 0;
  });
  return iface.encodeFunctionResult("speciesCatalog", values);
}

/** A fake Multicall3 that answers from a per-id table and records chunk sizes. */
function fakeMulticall(table) {
  const sizes = [];
  const aggregate3 = vi.fn(async (calls) => {
    sizes.push(calls.length);
    return calls.map(({ target, callData }) => {
      expect(target).toBe(ADDRESS);
      const parsed = iface.parseTransaction({ data: callData });
      const id = Number(parsed.args[0]);
      const row = table[id];
      if (!row) return { success: false, returnData: "0x" };
      if (parsed.name === "speciesCatalog") return { success: true, returnData: encodeSpecies(row.species) };
      if (row.countFails) return { success: false, returnData: "0x" };
      return { success: true, returnData: iface.encodeFunctionResult("getSpecimensCountByBreed", [row.count]) };
    });
  });
  return { aggregate3, sizes };
}

describe("readCatalogViaMulticall", () => {
  it("decodes species and counts in the same shape as direct contract calls", async () => {
    const mc = fakeMulticall({
      1: { species: { scientificName: "Oryzias latipes", commonName: "Medaka", active: true }, count: 7 },
      2: { species: { scientificName: "Betta splendens", commonName: "Betta", active: false }, count: 0 },
    });
    const out = await readCatalogViaMulticall(catalog, 2, { multicall: mc });
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(1);
    expect(out[0].species.scientificName).toBe("Oryzias latipes");
    expect(out[0].species.active).toBe(true);
    expect(Number(out[0].count)).toBe(7);
    expect(out[1].species.active).toBe(false);
  });

  it("chunks calls so 440 species take 5 requests, not 880", async () => {
    const table = {};
    for (let i = 1; i <= 440; i += 1) table[i] = { species: { scientificName: `S ${i}`, active: true }, count: i };
    const mc = fakeMulticall(table);
    const out = await readCatalogViaMulticall(catalog, 440, { multicall: mc });
    expect(out).toHaveLength(440);
    expect(mc.aggregate3).toHaveBeenCalledTimes(Math.ceil(880 / MULTICALL_CHUNK));
    expect(Math.max(...mc.sizes)).toBeLessThanOrEqual(MULTICALL_CHUNK);
    expect(Number(out[439].count)).toBe(440);
  });

  it("skips ids whose species read failed and reads a failed count as 0", async () => {
    const mc = fakeMulticall({
      1: { species: { scientificName: "A", active: true }, count: 3, countFails: true },
      3: { species: { scientificName: "C", active: true }, count: 1 },
    });
    const out = await readCatalogViaMulticall(catalog, 3, { multicall: mc });
    expect(out.map((e) => e.id)).toEqual([1, 3]);
    expect(Number(out[0].count)).toBe(0);
  });

  it("returns null so the caller falls back when Multicall3 is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mc = { aggregate3: vi.fn(async () => { throw new Error("call revert exception"); }) };
    expect(await readCatalogViaMulticall(catalog, 5, { multicall: mc })).toBeNull();
    warn.mockRestore();
  });

  it("returns an empty list for an empty catalog without calling out", async () => {
    const mc = { aggregate3: vi.fn() };
    expect(await readCatalogViaMulticall(catalog, 0, { multicall: mc })).toEqual([]);
    expect(mc.aggregate3).not.toHaveBeenCalled();
  });
});

// ─── multicallRead (generic helper) ──────────────────────────────────────────

const MARKET_ADDRESS = "0x0741D50d49e7374b855b532c17aD36aBF8AF3b3e";
const market = new Contract(MARKET_ADDRESS, marketplaceAbi);
const marketIface = market.interface;

/** Encode `fnName`'s return value with every output zeroed except the named ones. */
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

/** Fake Multicall3 that answers each sub-call through `answer(parsedTx)`. */
function fakeMulticallFor(ifc, target, answer) {
  const sizes = [];
  const aggregate3 = vi.fn(async (calls) => {
    sizes.push(calls.length);
    return calls.map(({ target: t, allowFailure, callData }) => {
      expect(t).toBe(target);
      expect(allowFailure).toBe(true);
      const out = answer(ifc.parseTransaction({ data: callData }));
      return out == null ? { success: false, returnData: "0x" } : { success: true, returnData: out };
    });
  });
  return { aggregate3, sizes };
}

const SELLER = "0x00000000000000000000000000000000000000A1";

describe("multicallRead", () => {
  it("returns multi-output results with named and positional fields, like a direct call", async () => {
    const mc = fakeMulticallFor(marketIface, MARKET_ADDRESS, (tx) =>
      encodeResult(marketIface, "listings", {
        tokenId: tx.args[0], seller: SELLER, price: 1250, shippingFee: 300, active: true, isShipping: true,
      }));
    const out = await multicallRead(market, "listings", [[3], [9]], { multicall: mc });
    expect(out).toHaveLength(2);
    expect(Number(out[0].tokenId)).toBe(3);
    expect(Number(out[1].tokenId)).toBe(9);
    expect(out[0].seller).toBe(SELLER);
    expect(out[0].active).toBe(true);
    expect(out[0].price.toString()).toBe("1250");
    expect(out[0][1]).toBe(SELLER); // positional access still works
  });

  it("returns the bare value for single-output functions", async () => {
    const mc = fakeMulticallFor(iface, ADDRESS, (tx) =>
      iface.encodeFunctionResult("getSpecimensCountByBreed", [Number(tx.args[0]) * 2]));
    const out = await multicallRead(catalog, "getSpecimensCountByBreed", [[1], [4]], { multicall: mc });
    expect(out.map(Number)).toEqual([2, 8]);
  });

  it("puts null at positions whose sub-call reverted or returned undecodable data", async () => {
    const mc = {
      aggregate3: vi.fn(async (calls) => [
        { success: true, returnData: encodeResult(marketIface, "listings", { tokenId: 1, active: true }) },
        { success: false, returnData: "0x" },
        { success: true, returnData: "0x" },
      ].slice(0, calls.length)),
    };
    const out = await multicallRead(market, "listings", [[1], [2], [3]], { multicall: mc });
    expect(out[0].active).toBe(true);
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull();
  });

  it("chunks at MULTICALL_CHUNK sub-calls per request", async () => {
    const mc = fakeMulticallFor(marketIface, MARKET_ADDRESS, (tx) =>
      encodeResult(marketIface, "batchListings", { listingId: tx.args[0] }));
    const argsList = Array.from({ length: 450 }, (_, k) => [k + 1]);
    const out = await multicallRead(market, "batchListings", argsList, { multicall: mc });
    expect(out).toHaveLength(450);
    expect(mc.aggregate3).toHaveBeenCalledTimes(Math.ceil(450 / MULTICALL_CHUNK));
    expect(Math.max(...mc.sizes)).toBeLessThanOrEqual(MULTICALL_CHUNK);
    expect(Number(out[449].listingId)).toBe(450);
  });

  it("returns null so the caller falls back when Multicall3 throws or answers short", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwing = { aggregate3: vi.fn(async () => { throw new Error("call revert exception"); }) };
    expect(await multicallRead(market, "listings", [[1]], { multicall: throwing })).toBeNull();
    const short = { aggregate3: vi.fn(async () => []) };
    expect(await multicallRead(market, "listings", [[1], [2]], { multicall: short })).toBeNull();
    warn.mockRestore();
  });

  it("returns an empty list for no calls without calling out", async () => {
    const mc = { aggregate3: vi.fn() };
    expect(await multicallRead(market, "listings", [], { multicall: mc })).toEqual([]);
    expect(mc.aggregate3).not.toHaveBeenCalled();
  });
});
