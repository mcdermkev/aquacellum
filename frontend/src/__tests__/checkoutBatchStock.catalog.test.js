/**
 * Guest/card checkout of a batch must size its stock hold from the inventory of
 * record, not only the chain.
 *
 * Found live (2026-09-26): Steve's batch listings 8000001–8000007 exist only
 * off-chain, so `batchListings(id).quantity` is 0 and every checkout of them was
 * refused OUT_OF_STOCK while the database said 2–4 left. These pin the fix in
 * `resolveReservationTargets` (frontend/api/stripe.js): read
 * `aquadex_listings.quantity_remaining` first, fall back to the chain only when
 * that column is NULL/unreadable, and never invent stock.
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

  it("consults the inventory of record BEFORE the chain", () => {
    const db = batch.indexOf("quantity_remaining");
    const chain = batch.indexOf("batchListings(");
    expect(db).toBeGreaterThan(-1);
    expect(chain).toBeGreaterThan(db);
  });

  it("falls back to the chain only when the column gave no answer", () => {
    // `stock` starts unknown (null), the chain read is guarded by `stock === null`.
    expect(batch).toMatch(/let stock = null;/);
    expect(batch).toMatch(/if \(stock === null\)\s*\{[\s\S]*batchListings\(/);
  });

  it("treats a NULL column as unknown, not as zero or unlimited", () => {
    expect(batch).toMatch(/quantity_remaining != null/);
  });

  it("never reports negative stock", () => {
    expect(batch).toMatch(/Math\.max\(0,/);
  });
});
