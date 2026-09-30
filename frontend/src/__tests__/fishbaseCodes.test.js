/**
 * FishBase codes vs catalog IDs.
 *
 * `specCode` is the Aquacellum catalog ID (user data keys on it). Many
 * freshwater records were numbered by hand (10114-10281, 70003, ...), so it is
 * NOT a FishBase SpecCode, and links built from it opened the wrong fish. The
 * real code is `fishbaseSpecCode`, written by scripts/fix-fishbase-codes.mjs
 * from the local FishBase dump. These tests pin that split.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fishbaseUrl } from "../../api/_lib/fishbaseUrl.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const CATALOG = JSON.parse(read("../../public/fishbase_master.json"));
const byId = new Map(CATALOG.map((r) => [r.specCode, r]));

const NON_FISHBASE = (r) =>
  ["plant", "invertebrate", "coral", "amphibian"].includes(r.type)
  || Number(r.marine?.aphiaId) > 0
  || (r.specCode >= 80001 && r.specCode <= 90999)
  || r.specCode >= 100000;

describe("fishbaseSpecCode", () => {
  it("keeps the catalog IDs and adds the real FishBase code alongside", () => {
    // Hand-numbered records: catalog ID unchanged, FishBase code from the dump.
    expect(byId.get(10114)).toMatchObject({ scientificName: "Trichopodus leerii", fishbaseSpecCode: 4674 });
    expect(byId.get(10281)).toMatchObject({ scientificName: "Otocinclus cocama", fishbaseSpecCode: 63139 });
    expect(byId.get(70005)).toMatchObject({ scientificName: "Osteoglossum bicirrhosum", fishbaseSpecCode: 6234 });
    // Already a FishBase code: same number.
    expect(byId.get(3615)).toMatchObject({ scientificName: "Amatitlania nigrofasciata", fishbaseSpecCode: 3615 });
  });

  it("is a positive integer on FishBase species and absent on everything else", () => {
    const withCode = CATALOG.filter((r) => "fishbaseSpecCode" in r);
    expect(withCode.length).toBeGreaterThan(400);
    for (const r of withCode) {
      expect(Number.isInteger(r.fishbaseSpecCode) && r.fishbaseSpecCode > 0).toBe(true);
      expect(NON_FISHBASE(r)).toBe(false);
    }
  });

  it("every record in the hand-numbered 10114-10281 band has a FishBase code that is not its catalog ID", () => {
    for (const r of CATALOG.filter((x) => x.specCode >= 10114 && x.specCode <= 10281)) {
      expect(Number.isInteger(r.fishbaseSpecCode)).toBe(true);
      expect(r.fishbaseSpecCode).not.toBe(r.specCode);
    }
  });

  it("maps genus moves checked by hand (catalog name kept, FishBase code of the current name)", () => {
    // Crenicichla compressiceps = FishBase Wallaciia compressiceps (Ploeg, 1986)
    expect(byId.get(10264)).toMatchObject({ scientificName: "Crenicichla compressiceps", fishbaseSpecCode: 46840 });
    // Crenicichla marmorata = FishBase Lugubria marmorata (Pellegrin, 1904)
    expect(byId.get(10265)).toMatchObject({ scientificName: "Crenicichla marmorata", fishbaseSpecCode: 52192 });
  });

  it("every FishBase fish without a code is a duplicate whose canonical record has one", () => {
    // 70002 Hemigrammus rhodostomus duplicates 12370 Petitella rhodostoma and
    // 70004 Brochis agassizii duplicates 10143 Corydoras agassizii. They keep
    // their IDs and carry duplicateOf (scripts/mark-duplicates.mjs); the
    // canonical record carries the FishBase code.
    const missing = CATALOG.filter((r) => !NON_FISHBASE(r) && !("fishbaseSpecCode" in r));
    expect(missing.map((r) => r.specCode).sort((a, b) => a - b)).toEqual([70002, 70004]);
    for (const r of missing) {
      expect(Number.isInteger(r.duplicateOf), `${r.specCode} has no fishbaseSpecCode and no duplicateOf`).toBe(true);
      const canonical = byId.get(r.duplicateOf);
      expect(canonical).toBeDefined();
      expect(canonical.duplicateOf).toBeUndefined();
      expect(Number.isInteger(canonical.fishbaseSpecCode)).toBe(true);
    }
    expect(byId.get(70002)).toMatchObject({ duplicateOf: 12370 });
    expect(byId.get(70004)).toMatchObject({ duplicateOf: 10143 });
    expect(byId.get(12370)).toMatchObject({ scientificName: "Petitella rhodostoma", fishbaseSpecCode: 12370 });
    expect(byId.get(10143)).toMatchObject({ scientificName: "Corydoras agassizii", fishbaseSpecCode: 13109 });
  });
});

describe("FishBase links", () => {
  it("use fishbaseSpecCode, never the catalog ID", () => {
    expect(fishbaseUrl(byId.get(10114))).toBe("https://www.fishbase.se/summary/4674");
    expect(fishbaseUrl(byId.get(3615))).toBe("https://www.fishbase.se/summary/3615");
  });

  it("fall back to the scientific name for fish without a known code", () => {
    expect(fishbaseUrl(byId.get(70004))).toBe("https://www.fishbase.se/summary/Brochis-agassizii.html");
  });

  it("are null for plants, inverts, corals and the axolotl", () => {
    for (const id of [90001, 80001, 67133, 67134, 200001]) {
      expect(byId.get(id)).toBeDefined();
      expect(fishbaseUrl(byId.get(id))).toBeNull();
    }
  });

  it("species.html and the public API do not build a FishBase URL from specCode", () => {
    const page = read("../../species.html");
    expect(page).toMatch(/sp\.fishbaseSpecCode/);
    expect(page).not.toMatch(/fishbase\.se\/summary\/\$\{(id|sp\.specCode)\}/);
    const api = read("../../api/species.js");
    expect(api).toMatch(/fishbaseSource: fishbaseUrl\(sp\)/);
    expect(api).not.toMatch(/fishbase\.se\/summary\/\$\{sp\.specCode\}/);
  });
});

describe("family and type", () => {
  it("family carries no (Plant) / (Invertebrate) / (Coral) suffix; type carries the kind", () => {
    for (const r of CATALOG) expect(String(r.family || "")).not.toMatch(/\((Plant|Invertebrate|Coral)\)$/);
  });

  it("the axolotl is an amphibian and the cherry shrimp an invertebrate", () => {
    expect(byId.get(67134)).toMatchObject({ scientificName: "Ambystoma mexicanum", family: "Ambystomatidae", type: "amphibian" });
    expect(byId.get(67133)).toMatchObject({ scientificName: "Neocaridina davidi", family: "Atyidae", type: "invertebrate" });
  });
});
