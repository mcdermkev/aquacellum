#!/usr/bin/env node
/**
 * strip-seed-defaults.mjs: remove placeholder values an old seed script baked
 * into the catalog as if they were data.
 *
 * scripts/seed_from_collectr.js used to fill missing fields with defaults:
 *   hardnessRange "5 - 15 dGH", biotope "Generic Biotope Details",
 *   comments / socialBehavior / reproduction.* "Information arriving soon",
 *   trophicLevel "Omnivore".
 * The text placeholders are already treated as missing at read time
 * (frontend/src/services/speciesCare.js), but "5 - 15 dGH" looks like a real
 * value and static pages read the raw JSON. Evidence that it is the default and
 * not data (checked 2026-10-06): 259 records carry exactly that string, all of
 * them in the original untyped batch that seed script produced, while every
 * other recorded hardness is worded differently ("Soft to medium hard
 * (5-19 dGH)", "6 - 15 dGH", ...).
 *
 * Removes, and only removes, these exact values:
 *   ecology.hardnessRange === "5 - 15 dGH"
 *   any ecology / reproduction text field === "No data available."
 *   any ecology / reproduction text field that is a known placeholder
 * Never touches trophicLevel: a seeded "Omnivore" can't be told apart from a
 * real one without a FishBase cross-check (see the handoff notes).
 *
 * Re-runnable. Writes both catalog mirrors byte-identically.
 *   node scripts/strip-seed-defaults.mjs          # report only
 *   node scripts/strip-seed-defaults.mjs --write  # write both mirrors
 *   node scripts/build-species-index.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIRRORS = [`${ROOT}frontend/public/fishbase_master.json`, `${ROOT}frontend/fishbase_master.json`];
const WRITE = process.argv.includes("--write");

const SEED_HARDNESS = "5 - 15 dGH";
const TEXT_PLACEHOLDERS = new Set([
  "information arriving soon",
  "generic biotope details",
  "no data available.",
  "no data available",
]);
const TEXT_FIELDS = {
  ecology: ["comments", "biotope", "socialBehavior", "hardnessRange"],
  reproduction: ["spawningTrait", "layoutRequirement", "comments"],
};

export function stripSeedDefaults(catalog) {
  const changes = [];
  const next = catalog.map((rec) => {
    let out = rec;
    for (const [block, fields] of Object.entries(TEXT_FIELDS)) {
      const src = rec[block];
      if (!src || typeof src !== "object") continue;
      let copy = null;
      for (const f of fields) {
        const v = src[f];
        if (typeof v !== "string") continue;
        const isSeedHardness = block === "ecology" && f === "hardnessRange" && v === SEED_HARDNESS;
        if (isSeedHardness || TEXT_PLACEHOLDERS.has(v.trim().toLowerCase())) {
          copy = copy || { ...src };
          delete copy[f];
          changes.push(`${rec.specCode} ${rec.scientificName}: ${block}.${f} ${JSON.stringify(v)}`);
        }
      }
      if (copy) out = { ...out, [block]: copy };
    }
    return out;
  });
  return { next, changes };
}

function main() {
  const text = readFileSync(MIRRORS[0], "utf8");
  for (const m of MIRRORS.slice(1)) {
    if (readFileSync(m, "utf8") !== text) throw new Error(`${m} differs from ${MIRRORS[0]}; sync the mirrors first`);
  }
  const { next, changes } = stripSeedDefaults(JSON.parse(text));
  const byField = {};
  for (const c of changes) {
    const key = c.split(": ")[1];
    byField[key] = (byField[key] || 0) + 1;
  }
  console.log(`${changes.length} value(s) ${WRITE ? "removed" : "would be removed"}:`);
  for (const [k, n] of Object.entries(byField)) console.log(`  ${n}  ${k}`);
  if (WRITE && changes.length) {
    const out = JSON.stringify(next, null, 2);
    for (const m of MIRRORS) writeFileSync(m, out);
    console.log(`Wrote ${MIRRORS.length} mirrors. Now run: node scripts/build-species-index.mjs`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
