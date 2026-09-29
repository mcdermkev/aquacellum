/**
 * Saltwater phase 2 (docs/SALTWATER_SPEC.md): reef vs fish-only tanks, curated
 * care for the marine fish, and the first corals and inverts (WoRMS).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  envelopeForTank, evaluateReading, getWaterEnvelope, isReefTank, marineStyleOf, tankKindLabel,
} from "../utils/tankUtils";
import { deriveTankHealth } from "../utils/tankHealth";
import { explainTankFlags } from "../utils/flagExplain";
import { evaluateTankFit, reefFit } from "../services/addOnRecommender";
import { tankFitInputs } from "../services/compatibleTanks";
import { normalizeSpeciesProfile } from "../services/shippingSafety";
import { toCatalogEntry, buildGlobalCatalog } from "../services/speciesCatalog";
import { speciesProfileForFit } from "../services/speciesFit";
import { getTypeNormalized } from "../hooks/useSpeciesSearch";
import { filterByWater, isReefLife } from "../components/finder/waterFilter";
import { rowToTankSpec } from "../utils/parseTankCsv";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const CATALOG = JSON.parse(read("../../public/fishbase_master.json"));
const REEF = { tankType: 1, marineStyle: "reef" };
const FOWLR = { tankType: 1, marineStyle: "fish_only" };

describe("reef vs fish-only saltwater tanks", () => {
  it("a saltwater tank with no style is a reef (the stricter targets)", () => {
    expect(marineStyleOf({ tankType: 1 })).toBe("reef");
    expect(marineStyleOf(FOWLR)).toBe("fish_only");
    expect(marineStyleOf({ tankType: 0, marineStyle: "reef" })).toBeNull();
    expect(isReefTank(REEF)).toBe(true);
    expect(tankKindLabel(FOWLR)).toBe("Saltwater · Fish only");
    expect(tankKindLabel({ tankType: 0 })).toBe("Freshwater");
  });
  it("reef holds nitrate to 10; fish-only allows 40 and drops the coral targets", () => {
    expect(envelopeForTank(REEF)).toMatchObject({ nitrateMax: 10, caMin: 380, po4Max: 0.1 });
    expect(envelopeForTank(FOWLR)).toMatchObject({ nitrateMax: 40, caMin: null, mgMin: null, po4Max: null, salinityMin: 1.023 });
    expect(getWaterEnvelope(0, { marineStyle: "fish_only" }).nitrateMax).toBe(20);
  });
  it("the same reading is judged by the tank's style", () => {
    const r = { nitrate: 25, ca: 300, po4: 0.4 };
    expect(evaluateReading(1, r, { marineStyle: "reef" }).flags).toHaveLength(3);
    expect(evaluateReading(1, r, { marineStyle: "fish_only" }).flags).toEqual([]);
    const reading = [{ nitrate: 25, timestamp: 1 }];
    expect(deriveTankHealth(FOWLR, { readings: reading, now: 1000 }).score)
      .toBeGreaterThan(deriveTankHealth(REEF, { readings: reading, now: 1000 }).score);
    expect(explainTankFlags(FOWLR, { readings: [{ ca: 300, po4: 0.5, timestamp: 1 }], now: 1000 }).items.map((i) => i.id))
      .not.toEqual(expect.arrayContaining(["calcium"]));
  });
  it("CSV import and new tanks carry the style", () => {
    const mapping = { name: 0, volumeLiters: 1, tankType: 2 };
    expect(rowToTankSpec(["A", "40", "FOWLR"], mapping).spec).toMatchObject({ tankType: 1, marineStyle: "fish_only" });
    expect(rowToTankSpec(["A", "40", "Reef"], mapping).spec).toMatchObject({ tankType: 1, marineStyle: "reef" });
    expect(rowToTankSpec(["A", "40", "Freshwater"], mapping).spec.marineStyle).toBeUndefined();
    const relayer = read("../services/relayer.js");
    expect(relayer).toMatch(/export async function relaySetMarineStyle\(tankId, style\)/);
    expect(relayer).toMatch(/Number\(tank\.tankType\) !== 1\) return \{ success: false/);
  });
  it("the tank detail offers the style and every envelope reader uses it", () => {
    const list = read("../components/TankList.jsx");
    expect(list).toMatch(/isSaltwaterTank\(activeTank\) && \(\s*<div role="group" aria-label="Saltwater style"/);
    expect(list).toMatch(/envelopeForTank\(selectedLogTank\)/);
    expect(read("../utils/flagExplain.js")).toMatch(/envelopeForTank\(tank\)/);
    expect(read("../utils/tankHealth.js")).toMatch(/marineStyle: tank\?\.marineStyle/);
  });
});

describe("reef fit rules", () => {
  const coral = { waterTypes: ["marine"], requiresReef: true, minVolumeGallons: 20, tempRange: [24, 27], phRange: [8, 8.4] };
  const lionfish = { waterTypes: ["marine"], reefSafe: "with caution", minVolumeGallons: 120, tempRange: [23, 27], phRange: [8.1, 8.4] };
  const emperor = { waterTypes: ["marine"], reefSafe: "no", minVolumeGallons: 180, tempRange: [23, 27], phRange: [8.1, 8.4] };
  const reefTank = { volume: 200, temp: 25, ph: 8.2, waterType: "marine", reef: true };
  const fowlrTank = { ...reefTank, reef: false };
  it("corals are blocked in a fish-only tank and fine in a reef", () => {
    expect(evaluateTankFit(coral, fowlrTank)).toMatchObject({ verdict: "blocked", score: 0 });
    expect(evaluateTankFit(coral, fowlrTank).reasons[0]).toMatch(/fish only/);
    expect(evaluateTankFit(coral, reefTank).verdict).toBe("ok");
  });
  it("fish that aren't reef safe are a caution in a reef, fine in fish-only", () => {
    expect(evaluateTankFit(emperor, reefTank)).toMatchObject({ verdict: "caution" });
    expect(evaluateTankFit(emperor, reefTank).reasons.join(" ")).toMatch(/Not reef safe/);
    expect(evaluateTankFit(lionfish, reefTank).verdict).toBe("caution");
    expect(evaluateTankFit(emperor, fowlrTank).verdict).toBe("ok");
  });
  it("only applies to saltwater tanks that know their style", () => {
    expect(reefFit(coral, { waterType: "marine" }).verdict).toBe("ok");
    expect(reefFit(coral, { waterType: "freshwater", reef: false }).verdict).toBe("ok");
    // A coral in fresh water is still blocked, by the water gate.
    expect(evaluateTankFit(coral, { volume: 50, temp: 25, ph: 7, waterType: "freshwater" }).verdict).toBe("blocked");
  });
  it("tanks and profiles carry the reef facts", () => {
    expect(tankFitInputs({ tankType: 1, volumeLiters: 200, marineStyle: "fish_only" })).toMatchObject({ waterType: "marine", reef: false });
    expect(tankFitInputs({ tankType: 1, volumeLiters: 200 }).reef).toBe(true);
    expect(tankFitInputs({ tankType: 0, volumeLiters: 200 })).not.toHaveProperty("reef");
    const torch = CATALOG.find((r) => r.scientificName === "Euphyllia glabrescens");
    expect(normalizeSpeciesProfile(torch)).toMatchObject({ requiresReef: true, reefSafe: "yes", waterTypes: ["marine"] });
    // On-chain-shaped entries get the reef facts from the curated record.
    const fit = speciesProfileForFit({ scientificName: "Euphyllia glabrescens" }, { fishbaseData: CATALOG });
    expect(fit.requiresReef).toBe(true);
  });
});

describe("curated care for the marine fish", () => {
  const fish = CATALOG.filter((r) => r.type === "fish" && r.waterTypes.includes("marine"));
  it("every marine fish has ranges, a minimum tank size and a temperament", () => {
    expect(fish.length).toBe(33);
    for (const r of fish) {
      const p = normalizeSpeciesProfile(r);
      expect(p.tempRange, r.scientificName).not.toBeNull();
      expect(p.phRange, r.scientificName).not.toBeNull();
      expect(p.minVolumeGallons, r.scientificName).toBeGreaterThanOrEqual(20);
      expect(p.temperament.value, r.scientificName).not.toBe("unknown");
      expect(r.careSource).toBe("curated");
    }
  });
  it("uses the conservative tank sizes", () => {
    const gal = (n) => fish.find((r) => r.scientificName === n).tankMetrics.minVolumeGallons;
    expect(gal("Amphiprion ocellaris")).toBe(20);
    expect(gal("Paracanthurus hepatus")).toBeGreaterThanOrEqual(125);
    expect(gal("Pomacanthus imperator")).toBeGreaterThanOrEqual(180);
  });
  it("a clownfish now fits a 30 gal reef and not a 10 gal", () => {
    const clown = toCatalogEntry(fish.find((r) => r.scientificName === "Amphiprion ocellaris")).profile;
    expect(evaluateTankFit(clown, { volume: 30, temp: 25, ph: 8.2, waterType: "marine", reef: true }).verdict).toBe("ok");
    expect(evaluateTankFit(clown, { volume: 8, temp: 25, ph: 8.2, waterType: "marine", reef: true }).verdict).toBe("blocked");
  });
});

describe("corals and marine invertebrates (WoRMS)", () => {
  const reefLife = CATALOG.filter(isReefLife);
  const corals = reefLife.filter((r) => r.type === "coral");
  const inverts = reefLife.filter((r) => r.type === "invertebrate");
  it("adds 25 corals and 12 inverts in their own ID band, with WoRMS sources", () => {
    expect(corals.length).toBe(25);
    expect(inverts.length).toBe(12);
    for (const r of reefLife) {
      expect(r.specCode, r.scientificName).toBeGreaterThanOrEqual(200001);
      expect(r.waterTypesSource).toBe("worms");
      expect(Number.isInteger(r.marine.aphiaId)).toBe(true);
      expect(r.sources[0].url).toBe(`https://www.marinespecies.org/aphia.php?p=taxdetails&id=${r.marine.aphiaId}`);
    }
    expect(new Set(CATALOG.map((r) => r.specCode)).size).toBe(CATALOG.length);
    // Nothing lands in the Supabase species_profiles band.
    expect(CATALOG.some((r) => r.specCode >= 100000 && r.specCode <= 199999)).toBe(false);
  });
  it("corals need a reef and carry light, flow and placement", () => {
    for (const c of corals) {
      expect(c.marine.requiresReef, c.scientificName).toBe(true);
      expect(["low", "medium", "high"]).toContain(c.marine.light);
      expect(["low", "medium", "high"]).toContain(c.marine.flow);
    }
    expect(toCatalogEntry(corals[0]).reefCare).toMatchObject({ coralType: "SPS", light: "high" });
    expect(inverts.every((i) => i.marine.requiresReef === false)).toBe(true);
  });
  it("uses the accepted WoRMS names, not the old trade names", () => {
    const names = CATALOG.map((r) => r.scientificName);
    expect(names).toContain("Fimbriaphyllia ancora");
    expect(names).not.toContain("Euphyllia ancora");
  });
  it("shows up under Corals / Inverts in the Aquadex and in Fish Finder", () => {
    expect(getTypeNormalized(corals[0])).toBe("Coral");
    expect(getTypeNormalized(inverts[0])).toBe("Invertebrate");
    const globals = buildGlobalCatalog(CATALOG);
    expect(filterByWater(globals, "reef_life", CATALOG).length).toBe(37);
    const gallery = read("../components/BreedGallery.jsx");
    expect(gallery).toMatch(/\{ val: "Coral", label: "Corals" \}/);
  });
  it("fixes the old '>= 9000 means plant' rule that filed fish under Plants", () => {
    const neon = CATALOG.find((r) => r.scientificName === "Paracheirodon innesi");
    expect(neon.specCode).toBeGreaterThan(9000);
    expect(getTypeNormalized(neon)).toBe("Fish");
    expect(getTypeNormalized({ specCode: 90005 })).toBe("Plant");
  });
});
