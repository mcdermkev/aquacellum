#!/usr/bin/env node
/**
 * fix-coral-invert-diet.mjs: give corals and a few marine invertebrates a real
 * `diet.trophicLevel`, so the app stops calling them "Omnivore".
 *
 * Why: coral records (add-reef-batch.mjs) carry their feeding mode in
 * `marine.feeding` but have no `diet` object. The species hooks
 * (useSpeciesData.js, useCatalogHydration.js) fill a missing trophicLevel with
 * "Omnivore", so every coral was shown as an omnivore.
 *
 * Corals: trophicLevel comes from the record's own `marine.feeding`, and only
 * when the genus is a known zooxanthellate (photosynthetic) genus. A coral whose
 * genus is not on that list, or a known non-photosynthetic genus (Tubastraea,
 * Dendronephthya, ...) labelled photosynthetic, is reported and left alone for a
 * human to check.
 *
 * Marine invertebrates: only records whose own notes contradict "Omnivore"
 * (algae grazers, a photosynthetic clam, a biofilm-grazing starfish). Scavengers
 * such as cleaner shrimp and hermit crabs are left alone.
 *
 * Never overwrites an existing `diet`. Writes both catalog mirrors identically.
 * species-index.json carries no diet, so it does not change, but rebuild it
 * after any catalog write anyway:
 *
 *   node scripts/fix-coral-invert-diet.mjs          # report only (dry run)
 *   node scripts/fix-coral-invert-diet.mjs --write  # write both mirrors
 *   node scripts/build-species-index.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIRRORS = [
  `${ROOT}frontend/public/fishbase_master.json`,
  `${ROOT}frontend/fishbase_master.json`,
];
const WRITE = process.argv.includes("--write");

// Genera in the catalog that host zooxanthellae (photosynthetic symbionts).
const ZOOXANTHELLATE_GENERA = new Set([
  "Acropora", "Montipora", "Seriatopora", "Stylophora", "Pocillopora",
  "Euphyllia", "Fimbriaphyllia", "Duncanopsammia", "Fungia", "Trachyphyllia",
  "Micromussa", "Caulastraea", "Blastomussa", "Sarcophyton", "Sclerophytum",
  "Xenia", "Clavularia", "Briareum", "Zoanthus", "Palythoa", "Discosoma",
  "Rhodactis", "Ricordea", "Entacmaea",
]);
// Genera with no zooxanthellae: they live on captured food only.
const NON_PHOTOSYNTHETIC_GENERA = new Set([
  "Tubastraea", "Dendronephthya", "Scleronephthya", "Carijoa",
]);

// marine.feeding (add-reef-batch.mjs vocabulary) -> trophicLevel.
const CORAL_TROPHIC = {
  "photosynthetic": "Photosynthetic",
  "photosynthetic + target feed": "Photosynthetic + target feed",
  "non-photosynthetic": "Non-photosynthetic (needs feeding)",
};

// Marine invertebrates, each backed by the record's own notes.
const INVERT_TROPHIC = {
  "Tridacna maxima": "Photosynthetic, filter feeder", // "Mostly photosynthetic ... with some filter feeding"
  "Trochus histrio": "Herbivore", // "Grazes film algae and diatoms"
  "Lithopoma tectum": "Herbivore", // "Grazes film and hair algae"
  "Mespilia globulus": "Herbivore", // "A strong algae grazer that also eats coralline algae"
  "Linckia laevigata": "Herbivore / Detritivore", // "Grazes biofilm and detritus"
};

/** Insert `diet` after `ecology` (where fish records keep it), else append. */
function withDiet(rec, diet) {
  if (!("ecology" in rec)) return { ...rec, diet };
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = v;
    if (k === "ecology") out.diet = diet;
  }
  return out;
}

function trophicFor(rec, problems) {
  if (rec.type === "coral") {
    const feeding = rec.marine?.feeding;
    const trophic = CORAL_TROPHIC[feeding];
    if (!trophic) { problems.push(`${rec.scientificName}: unknown marine.feeding ${JSON.stringify(feeding)}`); return null; }
    const photo = feeding !== "non-photosynthetic";
    if (photo && NON_PHOTOSYNTHETIC_GENERA.has(rec.genus)) {
      problems.push(`${rec.scientificName}: ${rec.genus} is non-photosynthetic but marine.feeding says "${feeding}"`);
      return null;
    }
    if (photo && !ZOOXANTHELLATE_GENERA.has(rec.genus)) {
      problems.push(`${rec.scientificName}: genus ${rec.genus} not on the zooxanthellate list; check by hand`);
      return null;
    }
    return trophic;
  }
  if (rec.type === "invertebrate") return INVERT_TROPHIC[rec.scientificName] || null;
  return null;
}

const [primary, ...rest] = MIRRORS;
const text = readFileSync(primary, "utf8");
for (const m of rest) {
  if (readFileSync(m, "utf8") !== text) throw new Error(`${m} differs from ${primary}; sync the mirrors first`);
}
const master = JSON.parse(text);
const changed = [];
const problems = [];
const next = master.map((rec) => {
  if (rec.diet) return rec;
  const trophicLevel = trophicFor(rec, problems);
  if (!trophicLevel) return rec;
  changed.push(`${rec.specCode}\t${rec.type}\t${rec.scientificName}\t${rec.marine?.feeding ?? ""}\t-> ${trophicLevel}`);
  return withDiet(rec, { trophicLevel });
});

console.log(`${changed.length} record(s) ${WRITE ? "updated" : "would change"}:`);
for (const line of changed) console.log(`  ${line}`);
if (problems.length) {
  console.log(`${problems.length} left alone:`);
  for (const p of problems) console.log(`  ${p}`);
}
if (WRITE && changed.length) {
  const out = JSON.stringify(next, null, 2);
  for (const m of MIRRORS) writeFileSync(m, out);
  console.log(`Wrote ${MIRRORS.length} mirrors.`);
}
