import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  checkGroup,
  compatForQuestion,
  findSpeciesInText,
  findTankInText,
  recordsInTank,
  searchCatalog,
  looksLikeCompatibilityQuestion,
  speciesFacts,
  tankFacts,
  MATCH,
} from "./echoMatch.js";

const CATALOG = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../public/fishbase_master.json", import.meta.url)), "utf8")
).filter((r) => !r.duplicateOf);
const bySci = (n) => CATALOG.find((r) => r.scientificName === n);

const CARDINAL = bySci("Paracheirodon axelrodi");
const RAM = bySci("Mikrogeophagus ramirezi");
const NEON = bySci("Paracheirodon innesi");
const CLOWN = bySci("Amphiprion ocellaris");

describe("checkGroup — real catalog records", () => {
  it("cardinal tetra + German blue ram: works with care, narrow warm overlap", () => {
    const r = checkGroup({ species: [CARDINAL, RAM] });
    expect(r.verdict).toBe(MATCH.CARE);
    const temp = r.rows.find((x) => x.key === "temp");
    // Cardinal 23-28, ram 26-30 in the catalog: shared 26-28 °C.
    expect(temp.detail).toContain("79–82°F (26–28°C)");
    expect(r.rows.find((x) => x.key === "temperament").label).toMatch(/German Blue Ram can be territorial/);
    expect(r.mood).toBe("alert");
  });

  it("flags the tank's own reading when it sits outside the shared range", () => {
    const r = checkGroup({ species: [CARDINAL, RAM], tank: { name: "Living room", volumeLiters: 76, tankType: 0, reading: { temp: 25, ph: 6.8 } } });
    const temp = r.rows.find((x) => x.key === "temp");
    expect(temp.status).toBe(MATCH.CARE);
    expect(temp.label).toBe("Your tank reads 25°C");
    expect(r.rows.find((x) => x.key === "size").status).toBe(MATCH.GOOD);
  });

  it("refuses to mix freshwater and saltwater", () => {
    const r = checkGroup({ species: [NEON, CLOWN] });
    expect(r.verdict).toBe(MATCH.BAD);
    expect(r.rows[0].key).toBe("water");
    expect(r.mood).toBe("concerned");
  });

  it("says a tank is too small with both numbers", () => {
    const r = checkGroup({ species: [RAM], tank: { name: "Nano", gallons: 5, tankType: 0 } });
    const size = r.rows.find((x) => x.key === "size");
    expect(size.status).toBe(MATCH.BAD);
    expect(size.detail).toContain("20+ gal");
    expect(size.detail).toContain("5 gal");
  });

  it("never fills in a missing range", () => {
    const blank = { commonName: "Mystery fish", scientificName: "Mysterius nullus", tankMetrics: {}, waterTypes: ["freshwater"] };
    const r = checkGroup({ species: [NEON, blank] });
    expect(r.rows.find((x) => x.key === "temp-missing").detail).toContain("Mystery fish");
    expect(speciesFacts(blank).temp).toBeNull();
  });

  it("gives no green light on too little data", () => {
    const blank = { commonName: "Mystery fish", scientificName: "Mysterius nullus", tankMetrics: {} };
    expect(checkGroup({ species: [blank] }).verdict).toBe(MATCH.UNKNOWN);
  });
});

describe("temperament as the catalog words it", () => {
  const BETTA = bySci("Betta splendens");

  it("reads a betta's aggression as toward its own kind, not a community", () => {
    const r = checkGroup({ species: [BETTA, NEON] });
    expect(r.verdict).toBe(MATCH.CARE);
    const row = r.rows.find((x) => x.key === "temperament");
    expect(row.label).toContain("rough on its own kind");
    expect(row.detail).toContain("conspecific males");
  });

  it("uses the catalog's own tankmate lists, both ways", () => {
    const bad = checkGroup({ species: [BETTA, bySci("Poecilia reticulata")] });
    expect(bad.verdict).toBe(MATCH.BAD);
    expect(bad.rows.find((x) => x.key === "tankmates").detail).toMatch(/flowing tails/);

    const good = checkGroup({ species: [BETTA, bySci("Corydoras aeneus")] });
    expect(good.verdict).toBe(MATCH.GOOD);
    expect(good.rows.find((x) => x.key === "tankmates").status).toBe(MATCH.GOOD);
  });
});

describe("tankFacts", () => {
  it("converts litres and tank type", () => {
    expect(tankFacts({ name: "A", volumeLiters: 76, tankType: 1 })).toMatchObject({ gallons: 20, water: "salt" });
  });
  it("keeps a missing reading missing", () => {
    expect(tankFacts({ name: "A" })).toMatchObject({ tempC: null, ph: null, gallons: null });
  });
});

describe("findSpeciesInText", () => {
  it("finds plural common names, longest match first", () => {
    const found = findSpeciesInText("Can I add German blue rams to my 20 gallon with 12 cardinal tetras?", CATALOG);
    expect(found.map((r) => r.scientificName)).toEqual(["Mikrogeophagus ramirezi", "Paracheirodon axelrodi"]);
  });

  it("matches scientific names and whole words only", () => {
    expect(findSpeciesInText("what about Paracheirodon innesi", CATALOG)[0].commonName).toBe("Neon Tetra");
    expect(findSpeciesInText("neontetra", CATALOG)).toEqual([]);
  });

  it("returns nothing for text with no species", () => {
    expect(findSpeciesInText("how often should I change the water", CATALOG)).toEqual([]);
  });
});

describe("names people actually type", () => {
  it("splits 'Betta / Siamese Fighting Fish' into both names", () => {
    expect(findSpeciesInText("can a betta live with neon tetras", CATALOG).map((r) => r.scientificName))
      .toEqual(["Betta splendens", "Paracheirodon innesi"]);
    expect(findSpeciesInText("siamese fighting fish", CATALOG)[0].scientificName).toBe("Betta splendens");
  });

  it("carries each member's photo and catalog code for the card", () => {
    const r = checkGroup({ species: [NEON, RAM] });
    expect(r.members.map((m) => m.specCode)).toEqual([NEON.specCode, RAM.specCode]);
  });
});

describe("searchCatalog (planner)", () => {
  it("finds by any part of the name and keeps to the water type", () => {
    const fresh = searchCatalog(CATALOG, "tetra", { water: "fresh" });
    expect(fresh.length).toBeGreaterThan(2);
    expect(fresh.every((r) => !(r.waterTypes || []).length || r.waterTypes.includes("freshwater"))).toBe(true);
    expect(searchCatalog(CATALOG, "clownfish", { water: "fresh" })).toEqual([]);
    expect(searchCatalog(CATALOG, "ocellaris", { water: "salt" })[0].scientificName).toBe("Amphiprion ocellaris");
  });

  it("leaves out what is already in the plan", () => {
    const out = searchCatalog(CATALOG, "neon tetra", { exclude: [NEON] });
    expect(out.some((r) => r.scientificName === NEON.scientificName)).toBe(false);
  });
});

describe("tanks in a question", () => {
  const TANKS = [
    { id: 1, name: "Living room", volumeLiters: 76, tankType: 0, specimens: [{ scientificName: "Paracheirodon innesi", status: 0 }] },
    { id: 2, name: "Reef", volumeLiters: 150, tankType: 1, specimens: [] },
  ];

  it("finds a tank by name, and 'my tank' only when there is one", () => {
    expect(findTankInText("can rams go in the living room tank", TANKS).id).toBe(1);
    expect(findTankInText("can rams go in my tank", TANKS)).toBeNull();
    expect(findTankInText("can rams go in my tank", [TANKS[0]]).id).toBe(1);
  });

  it("lists living inhabitants once, from the catalog", () => {
    const tank = { specimens: [{ scientificName: "Paracheirodon innesi", status: 0 }, { scientificName: "Paracheirodon innesi", status: 0 }, { scientificName: "Mikrogeophagus ramirezi", status: 1 }] };
    expect(recordsInTank(tank, CATALOG).map((r) => r.scientificName)).toEqual(["Paracheirodon innesi"]);
  });

  it("builds a card from the question plus the tank", () => {
    const tank = { ...TANKS[0], reading: { temp: 25, ph: 7 } };
    const r = compatForQuestion({ text: "Can I add German blue rams?", catalog: CATALOG, tank, tankRecords: recordsInTank(tank, CATALOG) });
    expect(r.names).toEqual(["German Blue Ram", "Neon Tetra"]);
  });

  it("stays quiet when there is nothing to compare or it is not that kind of question", () => {
    expect(compatForQuestion({ text: "Can I add German blue rams?", catalog: CATALOG })).toBeNull();
    expect(compatForQuestion({ text: "what do German blue rams eat", catalog: CATALOG, tank: TANKS[0] })).toBeNull();
  });
});

describe("looksLikeCompatibilityQuestion", () => {
  it("spots the usual phrasings", () => {
    for (const q of ["Can I add rams?", "are neons compatible with bettas", "will they get along", "good tankmates for a betta", "can a betta live with shrimp"]) {
      expect(looksLikeCompatibilityQuestion(q), q).toBe(true);
    }
    expect(looksLikeCompatibilityQuestion("what should I feed neons")).toBe(false);
  });
});
