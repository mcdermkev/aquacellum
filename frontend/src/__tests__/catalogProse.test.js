/**
 * Catalog prose guards (scripts/fix-catalog-typos.mjs).
 *
 * The FishBase import clipped long fields at fixed lengths, so hundreds of
 * descriptions ended mid-word, and a spell check found a handful of real typos.
 * The fix script repaired both; these tests keep them from coming back when a
 * new batch is imported.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  SPELLING,
  fixSpelling,
  isClipped,
  repairClipped,
} from "../../../scripts/fix-catalog-typos.mjs";

const CATALOG = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../public/fishbase_master.json", import.meta.url)), "utf8")
);

function proseFields(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => proseFields(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (!/url|photo|image|video|slug|scientificName|genus|^species$|family|specCode|duplicateOf|waterTypes|trophicSource/i.test(k)) {
        proseFields(v, out);
      }
    }
  }
  return out;
}
const FIELDS = CATALOG.flatMap((rec) => proseFields(rec));

describe("fix-catalog-typos helpers", () => {
  it("fixes whole words only", () => {
    expect(fixSpelling("clear and blcakwater streams")).toBe("clear and blackwater streams");
    expect(fixSpelling("Nymphea and Nymphaea")).toBe("Nymphaea and Nymphaea");
  });

  it("spots a field the import clipped at a fixed length", () => {
    const clipped = "x".repeat(299) + "a";
    expect(clipped.length).toBe(300);
    expect(isClipped(clipped)).toBe(true);
    expect(isClipped("x".repeat(299) + ".")).toBe(false);
    expect(isClipped("A short field without a stop")).toBe(false);
  });

  it("trims back to the last full sentence, skipping abbreviations", () => {
    const text = "Lives in streams (Ref. 5644). Attains 12 cm in captivity. Aquarium keeping: in pairs; mini";
    expect(repairClipped(text)).toBe("Lives in streams (Ref. 5644). Attains 12 cm in captivity.");
  });

  it("falls back to the last whole word plus an ellipsis, closing any open <i>", () => {
    const text = "Found under mats of <i>Commelina diffusa</i> and grass (<i>Brachiaria mut";
    expect(repairClipped(text)).toBe("Found under mats of <i>Commelina diffusa</i> and grass (<i>Brachiaria…</i>");
  });
});

describe("the committed catalog", () => {
  it("has no fields clipped mid-word by the import", () => {
    const clipped = FIELDS.filter(isClipped);
    expect(clipped.map((t) => t.slice(-60))).toEqual([]);
  });

  it("has none of the known misspellings", () => {
    const blob = FIELDS.join("\n");
    for (const [wrong] of SPELLING) {
      expect(blob.includes(wrong), `"${wrong}" is back in the catalog`).toBe(false);
    }
  });

  it("keeps <i> tags balanced so the species pages render cleanly", () => {
    const unbalanced = FIELDS.filter((t) => (t.match(/<i>/g) || []).length !== (t.match(/<\/i>/g) || []).length);
    expect(unbalanced).toEqual([]);
  });

  it("keeps both catalog mirrors identical", () => {
    const other = readFileSync(fileURLToPath(new URL("../../fishbase_master.json", import.meta.url)), "utf8");
    expect(other).toBe(JSON.stringify(CATALOG, null, 2));
  });
});
