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

  it("every record in the hand-numbered 10114-10281 band either has a FishBase code or is a known unresolved name", () => {
    const UNRESOLVED = new Set([10264, 10265]); // Crenicichla compressiceps / marmorata: not under that name in the dump
    for (const r of CATALOG.filter((x) => x.specCode >= 10114 && x.specCode <= 10281)) {
      if (UNRESOLVED.has(r.specCode)) expect(r.fishbaseSpecCode).toBeUndefined();
      else expect(r.fishbaseSpecCode).not.toBe(r.specCode);
    }
  });
});

describe("FishBase links", () => {
  it("use fishbaseSpecCode, never the catalog ID", () => {
    expect(fishbaseUrl(byId.get(10114))).toBe("https://www.fishbase.se/summary/4674");
    expect(fishbaseUrl(byId.get(3615))).toBe("https://www.fishbase.se/summary/3615");
  });

  it("fall back to the scientific name for fish without a known code", () => {
    expect(fishbaseUrl(byId.get(10264))).toBe("https://www.fishbase.se/summary/Crenicichla-compressiceps.html");
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
