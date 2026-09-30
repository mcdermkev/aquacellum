/**
 * Duplicate records in the species catalog (services/catalogAliases.js).
 *
 * A record that is the same species as another keeps its specCode (user data
 * keys on it) and carries `duplicateOf: <canonical specCode>`. Lists, counts
 * and search drop it; lookups by its ID resolve to the canonical record.
 * scripts/mark-duplicates.mjs writes the field.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isDuplicate,
  resolveSpecies,
  resolveRecord,
  canonicalSpecCode,
  aliasSpecCodesFor,
  visibleCatalog,
} from "../services/catalogAliases.js";
import { buildGlobalCatalog } from "../services/speciesCatalog.js";
import { speciesRecordFor } from "../components/logbook/inhabitants.js";
import { getSpeciesCare } from "../components/logbook/SpeciesCareGuide.jsx";
import { findCatalogRecord } from "../services/sexingGuide.js";
import { buildSpeciesIndex, INDEX_PATH } from "../../../scripts/build-species-index.mjs";
import { markDuplicates, DUPLICATES } from "../../../scripts/mark-duplicates.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const RAW = read("../../public/fishbase_master.json");
const CATALOG = JSON.parse(RAW);
const byId = new Map(CATALOG.map((r) => [r.specCode, r]));

// Small synthetic catalog for the helper's edge cases.
const A = { specCode: 1, scientificName: "Alpha one" };
const B = { specCode: 2, scientificName: "Beta two", duplicateOf: 1 };
const C = { specCode: 3, scientificName: "Gamma three", duplicateOf: 2 }; // chain: 3 -> 2 -> 1
const D = { specCode: 4, scientificName: "Delta four", duplicateOf: 99 }; // target missing
const E = { specCode: 5, scientificName: "Epsilon five", duplicateOf: 6 }; // cycle 5 <-> 6
const F = { specCode: 6, scientificName: "Zeta six", duplicateOf: 5 };
const G = { specCode: 7, scientificName: "Eta seven", duplicateOf: 7 }; // points at itself
const TOY = [A, B, C, D, E, F, G];

describe("catalogAliases helper", () => {
  it("isDuplicate reads duplicateOf, ignoring self-references and junk", () => {
    expect(isDuplicate(B)).toBe(true);
    expect(isDuplicate(A)).toBe(false);
    expect(isDuplicate(G)).toBe(false);
    expect(isDuplicate({ specCode: 1, duplicateOf: "x" })).toBe(false);
    expect(isDuplicate({ specCode: 1, duplicateOf: null })).toBe(false);
    expect(isDuplicate(null)).toBe(false);
  });

  it("resolveSpecies follows one hop to the canonical record", () => {
    expect(resolveSpecies(1, TOY)).toBe(A);
    expect(resolveSpecies(2, TOY)).toBe(A);
    expect(resolveSpecies("2", TOY)).toBe(A);
    expect(resolveSpecies(42, TOY)).toBeNull();
    expect(resolveSpecies("", TOY)).toBeNull();
    expect(resolveSpecies(null, TOY)).toBeNull();
    expect(resolveSpecies(1, null)).toBeNull();
  });

  it("never follows a chain, a cycle or a missing target: the record itself comes back", () => {
    expect(resolveSpecies(3, TOY)).toBe(C);
    expect(resolveSpecies(4, TOY)).toBe(D);
    expect(resolveSpecies(5, TOY)).toBe(E);
    expect(resolveSpecies(6, TOY)).toBe(F);
    expect(resolveSpecies(7, TOY)).toBe(G);
  });

  it("canonicalSpecCode and resolveRecord", () => {
    expect(canonicalSpecCode(2, TOY)).toBe(1);
    expect(canonicalSpecCode("1", TOY)).toBe(1);
    expect(canonicalSpecCode(42, TOY)).toBe(42);
    expect(canonicalSpecCode("nope", TOY)).toBeNull();
    expect(resolveRecord(B, TOY)).toBe(A);
    expect(resolveRecord(A, TOY)).toBe(A);
    expect(resolveRecord(C, TOY)).toBe(C);
    expect(resolveRecord(null, TOY)).toBeNull();
  });

  it("visibleCatalog drops only resolvable duplicates and tags the canonical record", () => {
    const visible = visibleCatalog(TOY);
    expect(visible.map((r) => r.specCode)).toEqual([1, 3, 4, 5, 6, 7]);
    expect(visible[0]).toEqual({ ...A, aliasSpecCodes: [2] });
    expect(visible[0]).not.toBe(A);
    expect(A).not.toHaveProperty("aliasSpecCodes"); // input untouched
    expect(visible[1]).toBe(C); // broken duplicates stay visible rather than vanish
  });

  it("old IDs still resolve on the visible catalog, and it is idempotent", () => {
    const visible = visibleCatalog(TOY);
    expect(resolveSpecies(2, visible)).toBe(visible[0]);
    expect(canonicalSpecCode(2, visible)).toBe(1);
    expect(resolveSpecies(3, visible)).toBe(C); // a chain stays unresolved here too
    expect(aliasSpecCodesFor(1, visible)).toEqual([2]);
    expect(aliasSpecCodesFor(1, TOY)).toEqual([2]);
    expect(aliasSpecCodesFor(3, TOY)).toEqual([]);
    expect(visibleCatalog(visible)).toBe(visible);
    const clean = [A];
    expect(visibleCatalog(clean)).toBe(clean);
    expect(visibleCatalog(undefined)).toEqual([]);
  });
});

describe("browser mirror (public/js/catalog-aliases.js) stays in lockstep", () => {
  // Evaluated through its real global-assignment path, as the page runs it
  // (same approach as the species-catalog.js parity test).
  const fakeRoot = {};
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("module", "window", "globalThis", read("../../public/js/catalog-aliases.js"))(mod, fakeRoot, fakeRoot);
  const mirror = fakeRoot.CatalogAliases;

  it("sets window.CatalogAliases", () => {
    expect(mirror).toBeTruthy();
    expect(mod.exports).toBe(mirror);
  });

  it("agrees with the module on the toy catalog and the real one", () => {
    for (const cat of [TOY, CATALOG]) {
      const ids = [...cat.map((r) => r.specCode), 42, "2", null];
      for (const id of ids) {
        expect(mirror.resolveSpecies(id, cat)).toBe(resolveSpecies(id, cat));
        expect(mirror.canonicalSpecCode(id, cat)).toBe(canonicalSpecCode(id, cat));
        expect(mirror.aliasSpecCodesFor(id, cat)).toEqual(aliasSpecCodesFor(id, cat));
      }
      for (const r of cat) {
        expect(mirror.isDuplicate(r)).toBe(isDuplicate(r));
        expect(mirror.resolveRecord(r, cat)).toBe(resolveRecord(r, cat));
      }
      expect(mirror.visibleCatalog(cat)).toEqual(visibleCatalog(cat));
    }
  });

  it("is loaded by the static pages that list or look up species", () => {
    for (const page of ["database.html", "compare.html", "species.html"]) {
      expect(read(`../../${page}`)).toMatch(/<script src="\/js\/catalog-aliases\.js"><\/script>/);
    }
    expect(read("../../database.html")).toMatch(/allSpecies = window\.CatalogAliases\.visibleCatalog\(/);
    expect(read("../../compare.html")).toMatch(/allSpecies = window\.CatalogAliases\.visibleCatalog\(/);
    expect(read("../../species.html")).toMatch(/CatalogAliases\.resolveRecord\(found, allSpecies\)/);
    expect(read("../../species.html")).toMatch(/history\.replaceState/);
  });
});

describe("the catalog data", () => {
  it("both mirrors are byte-identical", () => {
    expect(read("../../fishbase_master.json")).toBe(RAW);
  });

  it("flags the two known duplicates without renumbering or deleting them", () => {
    expect(byId.get(70002)).toMatchObject({ scientificName: "Hemigrammus rhodostomus", duplicateOf: 12370 });
    expect(byId.get(70004)).toMatchObject({ scientificName: "Brochis agassizii", duplicateOf: 10143 });
    expect(resolveSpecies(70002, CATALOG)).toMatchObject({ specCode: 12370, scientificName: "Petitella rhodostoma" });
    expect(resolveSpecies(70004, CATALOG)).toMatchObject({ specCode: 10143, scientificName: "Corydoras agassizii" });
  });

  it("every duplicateOf points at an existing record that is not itself a duplicate", () => {
    const dups = CATALOG.filter((r) => "duplicateOf" in r);
    expect(dups.map((r) => r.specCode).sort((a, b) => a - b)).toEqual([...DUPLICATES.keys()].sort((a, b) => a - b));
    for (const r of dups) {
      const target = byId.get(r.duplicateOf);
      expect(target, `${r.specCode} -> ${r.duplicateOf}`).toBeDefined();
      expect(isDuplicate(target)).toBe(false);
      expect(resolveSpecies(r.specCode, CATALOG)).toBe(target);
    }
  });

  it("no duplicate appears in visibleCatalog, and the count is the real one", () => {
    const visible = visibleCatalog(CATALOG);
    expect(visible.some(isDuplicate)).toBe(false);
    expect(visible.some((r) => r.specCode === 70002 || r.specCode === 70004)).toBe(false);
    expect(visible.length).toBe(CATALOG.length - CATALOG.filter(isDuplicate).length);
    expect(new Set(visible.map((r) => r.specCode)).size).toBe(visible.length);
    expect(visible.find((r) => r.specCode === 12370).aliasSpecCodes).toEqual([70002]);
    expect(visible.find((r) => r.specCode === 10143).aliasSpecCodes).toEqual([70004]);
  });

  it("scripts/mark-duplicates.mjs has nothing left to change and rejects bad data", () => {
    expect(markDuplicates(CATALOG).changes).toEqual([]);
    const withoutCanonical = CATALOG.filter((r) => r.specCode !== 12370);
    expect(() => markDuplicates(withoutCanonical)).toThrow(/canonical 12370/);
    const chained = CATALOG.map((r) => (r.specCode === 12370 ? { ...r, duplicateOf: 10143 } : r));
    expect(() => markDuplicates(chained)).toThrow(/12370/);
  });
});

describe("lists and counts skip duplicates", () => {
  it("the homepage index is built without them", () => {
    const rows = buildSpeciesIndex(CATALOG);
    expect(rows.find((r) => r.s === "Hemigrammus rhodostomus")).toBeUndefined();
    expect(rows.find((r) => r.s === "Brochis agassizii")).toBeUndefined();
    expect(rows.find((r) => r.s === "Petitella rhodostoma")).toBeDefined();
    const committed = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
    expect(committed.length).toBe(visibleCatalog(CATALOG).filter((r) => r.scientificName).length);
  });

  it("the in-app global catalog is built without them", () => {
    const entries = buildGlobalCatalog(CATALOG);
    expect(entries.some((e) => e.speciesId === 70002 || e.speciesId === 70004)).toBe(false);
    expect(entries.some((e) => e.speciesId === 12370)).toBe(true);
  });

  it("useSpeciesData filters through visibleCatalog", () => {
    expect(read("../hooks/useSpeciesData.js")).toMatch(/select: visibleCatalog/);
  });
});

describe("in-app lookups by an old ID resolve to the canonical record", () => {
  const visible = visibleCatalog(CATALOG);

  it("tank inhabitants (speciesRecordFor), on the full and the visible catalog", () => {
    const saved = { speciesId: 70004, commonName: "Agassiz", scientificName: "Brochis agassizii" };
    expect(speciesRecordFor(saved, CATALOG).specCode).toBe(10143);
    expect(speciesRecordFor(saved, visible).specCode).toBe(10143);
    expect(speciesRecordFor({ speciesId: 70002 }, visible).specCode).toBe(12370);
  });

  it("the care guide shows the canonical record's care data", () => {
    const care = getSpeciesCare({ speciesId: 70004, commonName: "Agassiz" }, visible, []);
    expect(care.maxLengthCm).toBe(byId.get(10143).maxLengthCm ?? undefined);
    expect(care.carePath).toMatch(/corydoras-agassizii/);
  });

  it("the sexing guide record lookup", () => {
    expect(findCatalogRecord(visible, { specCode: 70002 }).specCode).toBe(12370);
    expect(findCatalogRecord(CATALOG, { scientificName: "Hemigrammus rhodostomus" }).specCode).toBe(12370);
  });
});

describe("/api/species", () => {
  let handler;
  let ip = 0;

  beforeAll(async () => {
    // No Supabase in tests: no key lookups, no usage logging.
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_KEY", "");
    handler = (await import("../../api/species.js")).default;
  });

  async function call(query) {
    ip += 1;
    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      end() { return this; },
    };
    const req = { method: "GET", query, headers: { "x-forwarded-for": `10.0.0.${ip}` }, socket: {} };
    await handler(req, res);
    return res;
  }

  it("?id= with an old ID returns the canonical record plus resolvedFrom", async () => {
    const res = await call({ id: "70002" });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ specCode: 12370, scientificName: "Petitella rhodostoma", aliasSpecCodes: [70002] });
    expect(res.body.resolvedFrom).toMatchObject({ specCode: 70002, scientificName: "Hemigrammus rhodostomus" });
    expect(res.body.resolvedFrom.note).toBe("Hemigrammus rhodostomus is listed under its current name, Petitella rhodostoma.");
  });

  it("?id= with an old-name slug resolves too; a canonical ID has no resolvedFrom", async () => {
    const bySlug = await call({ id: "brochis-agassizii" });
    expect(bySlug.body.data.specCode).toBe(10143);
    expect(bySlug.body.resolvedFrom.specCode).toBe(70004);
    const direct = await call({ id: "10143" });
    expect(direct.body.data).toMatchObject({ specCode: 10143, aliasSpecCodes: [70004] });
    expect(direct.body).not.toHaveProperty("resolvedFrom");
  });

  it("list, search and stats count each species once", async () => {
    const visibleCount = visibleCatalog(CATALOG).length;
    const list = await call({ limit: "100" });
    expect(list.body.meta.total).toBe(visibleCount);
    const search = await call({ q: "rummy", limit: "100" });
    const codes = search.body.data.map((s) => s.specCode);
    expect(codes).toContain(12370);
    expect(codes).not.toContain(70002);
    const agassizii = await call({ q: "agassizii", limit: "100" });
    expect(agassizii.body.data.map((s) => s.specCode)).not.toContain(70004);
    const stats = await call({ stats: "true" });
    expect(stats.body.data.totalSpecies).toBe(visibleCount);
  });

  it("the OpenAPI spec documents resolvedFrom and aliasSpecCodes", () => {
    const spec = JSON.parse(read("../../public/species-openapi.json"));
    expect(spec.components.schemas.Species.properties.aliasSpecCodes).toBeDefined();
    expect(spec.components.schemas.ListResponse.properties.resolvedFrom).toBeDefined();
  });
});
