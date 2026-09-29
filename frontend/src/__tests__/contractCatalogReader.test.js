import { describe, it, expect, vi } from "vitest";
import { Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { readCatalogViaMulticall, MULTICALL_CHUNK } from "../services/contractCatalogReader";

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
