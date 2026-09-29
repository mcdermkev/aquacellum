#!/usr/bin/env node
/**
 * build-species-index.mjs — write frontend/public/species-index.json, the compact
 * search index the homepage uses.
 *
 * The full catalog (fishbase_master.json) is ~1.6 MB. The front door only needs
 * enough to search and show a result card, so it gets a small derived file
 * instead. Re-run after any catalog change:
 *
 *   node scripts/build-species-index.mjs
 *
 * speciesIndex.test.js rebuilds the index in memory and fails if the committed
 * file is stale.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const MASTER_PATH = `${ROOT}frontend/public/fishbase_master.json`;
export const INDEX_PATH = `${ROOT}frontend/public/species-index.json`;

/** Same slug rule as database.html and species.html. */
export function toSlug(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** fresh | marine | brackish, from the catalog's waterTypes. */
function waterOf(rec) {
  const types = Array.isArray(rec.waterTypes) ? rec.waterTypes : [];
  if (types.includes("marine")) return "marine";
  if (types.includes("freshwater")) return "fresh";
  if (types.includes("brackish")) return "brackish";
  return "fresh";
}

const KNOWN_DIFFICULTY = new Set(["Beginner", "Intermediate", "Advanced", "Expert", "Difficult"]);

/**
 * One compact row per species. Keys are short on purpose (the file ships to
 * every homepage visitor):
 *   n common name, s scientific name, u slug, f family, t type
 *   (fish|plant|coral|invertebrate), w water (fresh|marine|brackish),
 *   d difficulty (omitted when unknown), p photo URL, g min gallons
 */
export function buildSpeciesIndex(master) {
  const rows = [];
  for (const rec of Array.isArray(master) ? master : []) {
    if (!rec?.scientificName) continue;
    const row = {
      n: rec.commonName || rec.scientificName,
      s: rec.scientificName,
      u: toSlug(rec.scientificName),
      f: rec.family && rec.family !== "Information arriving soon" ? rec.family : "",
      t: rec.type || "fish",
      w: waterOf(rec),
    };
    const d = rec.tankMetrics?.difficulty;
    if (KNOWN_DIFFICULTY.has(d)) row.d = d;
    if (rec.masterPhotoUrl) row.p = rec.masterPhotoUrl;
    const g = Number(rec.tankMetrics?.minVolumeGallons);
    if (Number.isFinite(g) && g > 0) row.g = g;
    rows.push(row);
  }
  rows.sort((a, b) => a.n.localeCompare(b.n));
  return rows;
}

export function serializeIndex(rows) {
  return `${JSON.stringify(rows)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const master = JSON.parse(readFileSync(MASTER_PATH, "utf8"));
  const rows = buildSpeciesIndex(master);
  const out = serializeIndex(rows);
  writeFileSync(INDEX_PATH, out);
  console.log(`species-index.json: ${rows.length} species, ${(out.length / 1024).toFixed(1)} KB`);
}
