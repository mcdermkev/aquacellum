#!/usr/bin/env node
/**
 * fix-min-tank-from-fishbase.mjs: raise a species' minimum tank when it is
 * smaller than the minimum aquarium length in its own FishBase note.
 *
 * Many records quote FishBase in ecology.comments / biotope, e.g.
 *   "Aquarium keeping: in groups of 5 or more individuals; minimum aquarium
 *    size 80 cm (Ref. 51539)."
 * while tankMetrics.minVolumeGallons says 5. The gallon figure feeds tank fit
 * checks and stocking advice, so it must not be below the source.
 *
 * Conversion: the FishBase figure is a tank LENGTH. It maps to the smallest
 * common US glass tank at least that long (standard catalog dimensions):
 *   24 in (61 cm)  15 gal         30 in (76 cm)  20 gal long   36 in (91 cm)  30 gal
 *   48 in (122 cm) 40 gal long    60 in (152 cm) 90 gal        72 in (183 cm) 125 gal
 *
 * Rules: only ever RAISE minVolumeGallons, never lower it. Records with no
 * FishBase length, or already at or above the floor, are unchanged. Each change
 * records the source in tankMetrics.minVolumeSource.
 *
 *   node scripts/fix-min-tank-from-fishbase.mjs          # report only
 *   node scripts/fix-min-tank-from-fishbase.mjs --write  # write both mirrors
 *   node scripts/build-species-index.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIRRORS = [`${ROOT}frontend/public/fishbase_master.json`, `${ROOT}frontend/fishbase_master.json`];
const WRITE = process.argv.includes("--write");

/** [max length cm, gallons, label] */
export const STANDARD_TANKS = Object.freeze([
  [61, 15, "24 in"],
  [76, 20, "30 in"],
  [91, 30, "36 in"],
  [122, 40, "48 in"],
  [152, 90, "60 in"],
  [183, 125, "72 in"],
]);

const LENGTH_RE = /minimum aquarium size (\d+(?:\.\d+)?)\s*cm/i;

/** The FishBase minimum aquarium length in cm quoted by the record, or null. */
export function fishbaseMinLengthCm(rec) {
  for (const text of [rec?.ecology?.comments, rec?.ecology?.biotope]) {
    const m = typeof text === "string" ? text.match(LENGTH_RE) : null;
    if (m) return Number(m[1]);
  }
  return null;
}

/** Smallest standard tank at least `cm` long: { gallons, label } or null past 183 cm. */
export function standardTankFor(cm) {
  if (!(cm > 0)) return null;
  const hit = STANDARD_TANKS.find(([maxCm]) => cm <= maxCm);
  return hit ? { gallons: hit[1], label: hit[2] } : null;
}

export function fixMinTanks(catalog) {
  const changes = [];
  const next = catalog.map((rec) => {
    const cm = fishbaseMinLengthCm(rec);
    const tank = standardTankFor(cm);
    const current = Number(rec?.tankMetrics?.minVolumeGallons);
    if (!tank || !rec.tankMetrics || !Number.isFinite(current) || current >= tank.gallons) return rec;
    changes.push(`${rec.specCode}\t${rec.scientificName}\t${current} -> ${tank.gallons} gal (FishBase ${cm} cm, ${tank.label} tank)`);
    return {
      ...rec,
      tankMetrics: {
        ...rec.tankMetrics,
        minVolumeGallons: tank.gallons,
        minVolumeSource: `FishBase minimum aquarium length ${cm} cm; smallest standard ${tank.label} tank is ${tank.gallons} gal`,
      },
    };
  });
  return { next, changes };
}

function main() {
  const text = readFileSync(MIRRORS[0], "utf8");
  for (const m of MIRRORS.slice(1)) {
    if (readFileSync(m, "utf8") !== text) throw new Error(`${m} differs from ${MIRRORS[0]}; sync the mirrors first`);
  }
  const { next, changes } = fixMinTanks(JSON.parse(text));
  console.log(`${changes.length} record(s) ${WRITE ? "raised" : "would be raised"}:`);
  for (const c of changes) console.log(`  ${c}`);
  if (WRITE && changes.length) {
    const out = JSON.stringify(next, null, 2);
    for (const m of MIRRORS) writeFileSync(m, out);
    console.log(`Wrote ${MIRRORS.length} mirrors. Now run: node scripts/build-species-index.mjs`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
