/**
 * The homepage's compact species index must match the catalog it is derived
 * from. Regenerate with: node scripts/build-species-index.mjs
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  INDEX_PATH,
  MASTER_PATH,
  buildSpeciesIndex,
  serializeIndex,
  toSlug,
} from "../../../scripts/build-species-index.mjs";

const master = JSON.parse(readFileSync(MASTER_PATH, "utf8"));
const committed = readFileSync(INDEX_PATH, "utf8");
const rows = JSON.parse(committed);

describe("species-index.json", () => {
  it("is up to date with fishbase_master.json (run scripts/build-species-index.mjs)", () => {
    expect(committed.replace(/\r\n/g, "\n")).toBe(serializeIndex(buildSpeciesIndex(master)));
  });

  it("has one row per catalog species", () => {
    expect(rows.length).toBe(master.filter((r) => r?.scientificName).length);
    expect(rows.length).toBeGreaterThan(500);
  });

  it("uses the species page slug rule", () => {
    expect(toSlug("Paracheirodon innesi")).toBe("paracheirodon-innesi");
    expect(toSlug("Betta sp. 'Mahachai'")).toBe("betta-sp-mahachai");
    for (const r of rows) expect(r.u).toBe(toSlug(r.s));
  });

  it("classifies water and type for the homepage filters", () => {
    const types = new Set(rows.map((r) => r.t));
    for (const t of ["fish", "plant", "coral", "invertebrate"]) expect(types.has(t)).toBe(true);
    for (const r of rows) expect(["fresh", "marine", "brackish"]).toContain(r.w);
    expect(rows.find((r) => r.s === "Acropora millepora")).toMatchObject({ t: "coral", w: "marine" });
  });

  it("stays small enough for the front door", () => {
    expect(committed.length).toBeLessThan(150 * 1024);
  });
});
