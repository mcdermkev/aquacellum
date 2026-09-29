/**
 * contractCatalogReader.js: read the on-chain species catalog in a few RPC calls.
 *
 * The catalog has hundreds of species and each needs two reads
 * (speciesCatalog(i) and getSpecimensCountByBreed(i)). Issued one by one, a
 * single page load sent about 900 eth_calls to the public Base Sepolia RPC,
 * which answers "25/second request limit reached" (HTTP 429), and the provider's
 * retries roughly tripled that. Multicall3 bundles the reads into one eth_call
 * per chunk, so the same catalog costs about 10 requests.
 *
 * Multicall3 lives at the same address on every major EVM chain, including
 * Base Sepolia. If it is missing (for example a local Hardhat node) or the call
 * fails, the caller gets `null` and falls back to per-call reads.
 */
import { Contract } from "ethers";

export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)",
];

/** Sub-calls per aggregate3 request. Two per species, so 100 species per request. */
export const MULTICALL_CHUNK = 200;

/**
 * Read speciesCatalog(i) and getSpecimensCountByBreed(i) for ids 1..totalCount.
 *
 * @param {import("ethers").Contract} catalogContract  AquadexManager contract (provider-connected)
 * @param {number} totalCount  highest species id (nextSpeciesId - 1)
 * @param {object} [opts]
 * @param {import("ethers").Contract} [opts.multicall]  injected Multicall3 (tests)
 * @returns {Promise<Array<{id:number, species:any, count:any}>|null>}
 *   One entry per id whose speciesCatalog read succeeded (a failed count reads
 *   as 0), or null when Multicall3 is unavailable and the caller should fall back.
 */
export async function readCatalogViaMulticall(catalogContract, totalCount, opts = {}) {
  if (!catalogContract || !(totalCount > 0)) return [];
  const iface = catalogContract.interface;
  const target = catalogContract.address;
  const multicall = opts.multicall
    || new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, catalogContract.provider);

  const calls = [];
  for (let i = 1; i <= totalCount; i += 1) {
    calls.push({ target, allowFailure: true, callData: iface.encodeFunctionData("speciesCatalog", [i]) });
    calls.push({ target, allowFailure: true, callData: iface.encodeFunctionData("getSpecimensCountByBreed", [i]) });
  }

  const results = [];
  try {
    for (let start = 0; start < calls.length; start += MULTICALL_CHUNK) {
      const chunk = calls.slice(start, start + MULTICALL_CHUNK);
      const out = await multicall.aggregate3(chunk);
      if (!Array.isArray(out) || out.length !== chunk.length) return null;
      results.push(...out);
    }
  } catch (err) {
    console.warn("[contractCatalog] Multicall3 read failed, falling back to single calls:", err?.message || err);
    return null;
  }

  const entries = [];
  for (let i = 1; i <= totalCount; i += 1) {
    const speciesRes = results[(i - 1) * 2];
    const countRes = results[(i - 1) * 2 + 1];
    if (!speciesRes?.success) continue;
    let species;
    try {
      species = iface.decodeFunctionResult("speciesCatalog", speciesRes.returnData);
    } catch {
      continue;
    }
    let count = 0;
    if (countRes?.success) {
      try {
        count = iface.decodeFunctionResult("getSpecimensCountByBreed", countRes.returnData)[0];
      } catch {
        count = 0;
      }
    }
    entries.push({ id: i, species, count });
  }
  return entries;
}
