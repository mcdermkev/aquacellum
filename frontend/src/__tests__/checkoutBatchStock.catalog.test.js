/**
 * Guest/card checkout of a batch must size its stock hold from the inventory of
 * record, capped by the chain for batches that exist on-chain.
 *
 * Found live (2026-09-26): Steve's batch listings 8000001–8000007 exist only
 * off-chain, so `batchListings(id).quantity` is 0 and every checkout of them was
 * refused OUT_OF_STOCK while the database said 2–4 left. Review (2026-09-28):
 * crypto purchases lower the chain but not quantity_remaining, so for real
 * on-chain batches the smaller of the two must win.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const RAW = readFileSync(fileURLToPath(new URL("../../api/stripe.js", import.meta.url)), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function fnBody(name) {
  const start = CODE.indexOf(`async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const rest = CODE.slice(start + 1);
  const next = rest.search(/\n(?:async\s+)?function\s|\nexport\s|\nconst\s+[A-Z_]+\s*=/);
  return CODE.slice(start, next > -1 ? start + 1 + next : undefined);
}

describe("resolveReservationTargets — batch stock source", () => {
  const body = fnBody("resolveReservationTargets");
  const batch = body.slice(body.indexOf('purchaseType === "batch"'), body.indexOf('purchaseType === "multi"'));

  it("reads quantity_remaining from aquadex_listings for the listing", () => {
    expect(batch).toContain('.from("aquadex_listings")');
    expect(batch).toMatch(/\.select\("quantity_remaining"\)/);
    expect(batch).toMatch(/\.eq\("id",\s*String\(it\.listingId\)\)/);
  });

  it("only uses the chain for batches that actually exist on-chain (non-zero seller)", () => {
    expect(batch).toMatch(/!\/\^0x0\{40\}\$\/i\.test\(String\(b\.seller\)\)/);
  });

  it("takes the smaller of DB and chain when both are known, and the chain when the DB is NULL", () => {
    expect(batch).toMatch(/if \(stock === null\) stock = chain \?\? 0;/);
    expect(batch).toMatch(/else if \(chain !== null\) stock = Math\.min\(stock, chain\);/);
  });

  it("bounds the chain read so a slow RPC cannot stall checkout", () => {
    expect(batch).toMatch(/Promise\.race\(/);
    expect(CODE).toMatch(/const CHAIN_STOCK_TIMEOUT_MS = \d+;/);
  });

  it("treats a NULL column as unknown, not as zero or unlimited", () => {
    expect(batch).toMatch(/quantity_remaining != null/);
  });

  it("never reports negative stock", () => {
    expect(batch).toMatch(/Math\.max\(0,/);
  });
});
