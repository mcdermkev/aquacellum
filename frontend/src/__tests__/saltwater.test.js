/**
 * Saltwater (docs/SALTWATER_SPEC.md): tank type, the marine water envelope and
 * explanations, the saltwater test fields, the fresh/marine fit gate, and the
 * catalog's water types and first marine fish.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  TANK_TYPE_OPTIONS, evaluateReading, getWaterEnvelope, isSaltwaterTank, marineFormFromLog, marineLogFields, tankTypeLabel, waterTestFields,
} from "../utils/tankUtils";
import { deriveTankHealth, normalizeReading } from "../utils/tankHealth";
import { explainTankFlags } from "../utils/flagExplain";
import { evaluateTankFit, tankWaterType, waterTypeFit } from "../services/addOnRecommender";
import { tankFitInputs } from "../services/compatibleTanks";
import { normalizeSpeciesProfile } from "../services/shippingSafety";
import { buildGlobalCatalog, catalogWaterGroup, toCatalogEntry } from "../services/speciesCatalog";
import { speciesProfileForFit } from "../services/speciesFit";
import { filterByWater, withMarineGlobals } from "../components/finder/waterFilter";

const CATALOG = JSON.parse(readFileSync(fileURLToPath(new URL("../../public/fishbase_master.json", import.meta.url)), "utf8"));
const MIRROR = readFileSync(fileURLToPath(new URL("../../fishbase_master.json", import.meta.url)), "utf8");
const REEF = { tankType: 1 };
const GOOD_REEF = { temp: 25.5, ph: 8.2, ammonia: 0, nitrite: 0, nitrate: 5, kh: 8.5, salinity: 1.025, ca: 420, mg: 1350, po4: 0.03 };

describe("saltwater tank type", () => {
  it("is selectable at its on-chain index (1), with its own label", () => {
    expect(TANK_TYPE_OPTIONS.map((o) => o.id)).toEqual([0, 1, 2, 3]);
    expect(tankTypeLabel(1)).toBe("Saltwater");
    expect(isSaltwaterTank(1)).toBe(true);
    expect(isSaltwaterTank({ tankType: "1" })).toBe(true);
    expect(isSaltwaterTank(0)).toBe(false);
    expect(tankWaterType(1)).toBe("marine");
    expect(tankWaterType(3)).toBe("freshwater");
  });
  it("the tank forms read the shared list instead of hardcoding one", () => {
    for (const f of ["../components/BulkTankModal.jsx", "../components/FacilityTreeView.jsx"]) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
      expect(src, f).toMatch(/TANK_TYPE_OPTIONS/);
      expect(src, f).not.toMatch(/\{ label: "Brackish", value: "2" \}/);
    }
  });
  it("offers marine test fields and drops GH/TAL for saltwater", () => {
    expect(waterTestFields(1)).toEqual(expect.arrayContaining(["salinity", "kh", "ca", "mg", "po4"]));
    expect(waterTestFields(1)).not.toContain("gh");
    expect(waterTestFields(0)).not.toContain("salinity");
  });
});

describe("marine water envelope", () => {
  it("a healthy reef reading raises no flags", () => {
    expect(evaluateReading(1, GOOD_REEF).flags).toEqual([]);
  });
  it("reef pH and alkalinity aren't flagged the way freshwater would be", () => {
    expect(evaluateReading(0, { ph: 8.2, kh: 9 }).flags.length).toBe(2);
    expect(evaluateReading(1, { ph: 8.2, kh: 9 }).flags).toEqual([]);
  });
  it("flags salinity, calcium, magnesium and phosphate out of range", () => {
    const r = evaluateReading(1, { salinity: 1.019, ca: 330, mg: 1100, po4: 0.3 });
    expect(r).toMatchObject({ salinityOk: false, caOk: false, mgOk: false, po4Ok: false });
    expect(r.flags).toHaveLength(4);
  });
  it("never judges freshwater on marine fields, or a reef on GH", () => {
    expect(evaluateReading(0, { salinity: 1.025, ca: 50, po4: 2 }).flags).toEqual([]);
    expect(evaluateReading(1, { gh: 30 }).flags).toEqual([]);
    expect(getWaterEnvelope(0).salinityMin).toBeNull();
  });
  it("salinity out of range lowers the tank's health score", () => {
    const ok = deriveTankHealth(REEF, { readings: [{ ...GOOD_REEF, timestamp: 1 }], now: 1000 });
    const low = deriveTankHealth(REEF, { readings: [{ ...GOOD_REEF, salinity: 1.018, timestamp: 1 }], now: 1000 });
    expect(ok.score - low.score).toBe(15);
  });
  it("explains each marine flag with a target and an action", () => {
    const { items } = explainTankFlags(REEF, { readings: [{ ...GOOD_REEF, salinity: 1.029, kh: 5, ca: 350, mg: 1450, po4: 0.25, timestamp: 1 }], now: 1000 });
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["salinity", "alkalinity", "calcium", "magnesium", "phosphate"]));
    const sal = items.find((i) => i.id === "salinity");
    expect(sal.label).toBe("Salinity too high");
    expect(sal.action).toMatch(/fresh RO\/DI/);
    // Freshwater tanks never get the reef-only alkalinity explanation.
    const fw = explainTankFlags({ tankType: 0 }, { readings: [{ kh: 1, timestamp: 1 }], now: 1000 });
    expect(fw.items.map((i) => i.id)).not.toContain("alkalinity");
  });
});

describe("saltwater readings: stored and read back", () => {
  it("the form maps to the stored fields; blanks stay blank instead of 0", () => {
    expect(marineLogFields({ salinity: "1.025", ca: "420", mg: "", po4: "0.04" }))
      .toEqual({ salinitySgX10000: 10250, caPpm: 420, mgPpm: null, po4PpmX100: 4 });
    expect(marineLogFields({ salinity: "nope" }).salinitySgX10000).toBe(0);
  });
  it("a stored log reads back as a normalized reading", () => {
    expect(normalizeReading({ salinitySgX10000: 10250, caPpm: 420, mgPpm: 1350, po4PpmX100: 4, khX10: 85 }))
      .toMatchObject({ salinity: 1.025, ca: 420, mg: 1350, po4: 0.04, kh: 8.5 });
  });
  it("the old 1.0000 / 0 salinity placeholders aren't read as a measurement", () => {
    expect(normalizeReading({ salinitySgX10000: 10000, tempCelsiusX10: 250 }).salinity).toBeUndefined();
    expect(normalizeReading({ salinitySgX10000: 0, tempCelsiusX10: 250 }).salinity).toBeUndefined();
  });
  it("prefill repeats the last marine reading, and is empty for freshwater", () => {
    expect(marineFormFromLog({ salinitySgX10000: 10240, khX10: 90, caPpm: 410, po4PpmX100: 5 }, 1))
      .toEqual({ salinity: "1.024", kh: "9", ca: "410", mg: "", po4: "0.05" });
    expect(marineFormFromLog(null, 1)).toMatchObject({ salinity: "1.025", kh: "8.0" });
    expect(marineFormFromLog({ khX10: 50 }, 0)).toEqual({});
  });
  it("the water test sends each tank the fields for its own water type", () => {
    const src = readFileSync(fileURLToPath(new URL("../components/TankList.jsx", import.meta.url)), "utf8");
    expect(src).toMatch(/const salt = isSaltwaterTank\(tank\);/);
    expect(src).toMatch(/salinitySgX10000: salt \? marine\.salinitySgX10000 : 0/);
    expect(src).toMatch(/isSaltwaterTank\(selectedLogTank\) && \(\s*<MarineTestFields/);
  });
});

describe("fresh/marine fit gate", () => {
  const clown = { waterTypes: ["marine"], minVolumeGallons: 20, tempRange: [24, 27], phRange: [8, 8.4] };
  const tetra = { waterTypes: ["freshwater"], minVolumeGallons: 10, tempRange: [22, 26], phRange: [6, 7.5] };
  it("blocks marine fish in freshwater and freshwater fish in saltwater", () => {
    expect(evaluateTankFit(clown, { volume: 40, temp: 25, ph: 8.2, waterType: "freshwater" })).toMatchObject({ verdict: "blocked", score: 0 });
    expect(evaluateTankFit(tetra, { volume: 40, temp: 24, ph: 7, waterType: "marine" }).reasons[0]).toMatch(/freshwater species.*saltwater/);
  });
  it("lets the right water through", () => {
    expect(evaluateTankFit(clown, { volume: 40, temp: 25, ph: 8.2, waterType: "marine" }).verdict).toBe("ok");
  });
  it("a freshwater-only fish in brackish is a caution, not a block", () => {
    expect(waterTypeFit(["freshwater"], "brackish").verdict).toBe("caution");
    expect(evaluateTankFit(tetra, { volume: 40, temp: 24, ph: 7, waterType: "brackish" }).verdict).toBe("caution");
    expect(waterTypeFit(["freshwater", "brackish"], "brackish").verdict).toBe("ok");
  });
  it("unknown water on either side never blocks (old callers keep working)", () => {
    expect(waterTypeFit(null, "marine").verdict).toBe("ok");
    expect(evaluateTankFit(tetra, { volume: 40, temp: 24, ph: 7 }).verdict).toBe("ok");
  });
  it("tanks and profiles carry the water type into the check", () => {
    expect(tankFitInputs({ tankType: 1, volumeLiters: 100 }).waterType).toBe("marine");
    expect(normalizeSpeciesProfile({ waterTypes: ["marine", "bogus"] }).waterTypes).toEqual(["marine"]);
    expect(normalizeSpeciesProfile({}).waterTypes).toBeNull();
    // On-chain entries have no habitat; it comes from the curated record.
    const fit = speciesProfileForFit({ scientificName: "Amphiprion ocellaris", minTemp: 24, maxTemp: 27 }, { fishbaseData: CATALOG });
    expect(fit.waterTypes).toEqual(["marine"]);
  });
});

describe("catalog water types and the first marine fish", () => {
  it("both catalog mirrors are identical", () => {
    expect(JSON.parse(MIRROR)).toEqual(CATALOG);
  });
  it("every record has a water type, from FishBase or marked curated", () => {
    for (const r of CATALOG) {
      expect(Array.isArray(r.waterTypes) && r.waterTypes.length > 0, r.scientificName).toBe(true);
      expect(["fishbase", "curated", "worms"]).toContain(r.waterTypesSource);
    }
  });
  it("adds the marine batch from FishBase, with reef-safety notes and no duplicate ids or names", () => {
    // Marine FISH; corals and inverts come from WoRMS (reef.test.js).
    const marine = CATALOG.filter((r) => r.waterTypes.includes("marine") && r.type === "fish");
    expect(marine.length).toBeGreaterThanOrEqual(33);
    for (const r of marine) {
      expect(r.waterTypesSource, r.scientificName).toBe("fishbase");
      expect(["yes", "no", "with caution"], r.scientificName).toContain(r.marine?.reefSafe);
      expect(r.sources[0].url).toMatch(/^https:\/\/www\.fishbase\.se\/summary\//);
    }
    expect(new Set(CATALOG.map((r) => r.specCode)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map((r) => r.scientificName.toLowerCase())).size).toBe(CATALOG.length);
    expect(marine.find((r) => r.scientificName === "Amphiprion ocellaris")).toMatchObject({ specCode: 6509, commonName: "Ocellaris clownfish" });
  });
  it("marine cards show marine ranges, never freshwater ones", () => {
    const clown = CATALOG.find((r) => r.scientificName === "Amphiprion ocellaris");
    expect(catalogWaterGroup(clown)).toBe("marine");
    // Curated care is used when present…
    expect(toCatalogEntry(clown)).toMatchObject({ waterGroup: "marine", minPh: 8.1, maxPh: 8.4, reefSafe: "yes" });
    // …and a marine record without it falls back to marine display ranges,
    // while its profile stays honest (unknown).
    const bare = toCatalogEntry({ scientificName: "X y", waterTypes: ["marine"] });
    expect(bare).toMatchObject({ minPh: 8.0, maxPh: 8.4 });
    expect(bare.profile.phRange).toBeNull();
    expect(toCatalogEntry({ scientificName: "X y" }).minPh).toBe(6.5);
  });
});

describe("Fish Finder water filter", () => {
  const globals = buildGlobalCatalog(CATALOG);
  it("marine species are added to an on-chain catalog that doesn't have them", () => {
    const contract = [{ speciesId: 1, scientificName: "Paracheirodon innesi" }, { speciesId: 2, scientificName: "Amphiprion ocellaris" }];
    const merged = withMarineGlobals(contract, globals);
    expect(merged.slice(0, 2)).toEqual(contract);
    expect(merged.filter((e) => e.scientificName === "Amphiprion ocellaris")).toHaveLength(1);
    expect(merged.some((e) => e.scientificName === "Zebrasoma flavescens")).toBe(true);
    expect(withMarineGlobals([], globals)).toBe(globals);
  });
  it("filters by water, using the curated record for on-chain entries", () => {
    const mixed = [{ scientificName: "Paracheirodon innesi" }, { scientificName: "Amphiprion ocellaris" }, ...globals.slice(0, 3)];
    expect(filterByWater(mixed, "marine", CATALOG).map((e) => e.scientificName)).toEqual(["Amphiprion ocellaris"]);
    expect(filterByWater(mixed, "all", CATALOG)).toBe(mixed);
    expect(filterByWater(mixed, "freshwater", CATALOG).some((e) => e.scientificName === "Amphiprion ocellaris")).toBe(false);
  });
});
