#!/usr/bin/env node
/**
 * mark-duplicates.mjs: flag catalog records that are the same species as
 * another record, with `"duplicateOf": <canonical specCode>`.
 *
 * `specCode` is the catalog's own ID and user data keys on it (tank/specimen
 * `speciesId`, listings `species_id`, species_insights `spec_code`, Dexie
 * `db.species`, /api/species?id=). So a duplicate is never deleted or
 * renumbered. It keeps its specCode and its data; readers hide it from lists,
 * counts and search and resolve lookups of its ID to the canonical record
 * (frontend/src/services/catalogAliases.js).
 *
 * DUPLICATES below is the reviewed list. For each entry the script asserts:
 *   - the duplicate record exists under that specCode and scientific name
 *   - the canonical record exists under that specCode and scientific name
 *   - the canonical record is not itself a duplicate (no chains, no cycles)
 * and, over the whole catalog, that every `duplicateOf` in the data is in the
 * list (a hand edit fails loudly instead of slipping through).
 *
 * Re-runnable and idempotent. Writes both catalog mirrors byte-identically,
 * then rebuild the homepage index:
 *
 *   node scripts/mark-duplicates.mjs            # report only (dry run)
 *   node scripts/mark-duplicates.mjs --write    # write both mirrors
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

// duplicate specCode -> [duplicate name, canonical specCode, canonical name, why]
export const DUPLICATES = new Map([
  // Hemigrammus rhodostomus was moved to Petitella; FishBase 12370 is
  // Petitella rhodostoma. Same fish, both records are "Rummy Nose Tetra".
  [70002, ["Hemigrammus rhodostomus", 12370, "Petitella rhodostoma", "older name of Petitella rhodostoma"]],
  // 70004's own ecology.comments: "Now reclassified as Corydoras agassizii".
  // 10143 Corydoras agassizii is FishBase 13109.
  [70004, ["Brochis agassizii", 10143, "Corydoras agassizii", "older name of Corydoras agassizii"]],
]);

function fail(message) {
  throw new Error(`mark-duplicates: ${message}`);
}

/** Rebuild the record with duplicateOf right after specCode (or without it). */
function withDuplicateOf(rec, canonical) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === "duplicateOf") continue;
    out[k] = v;
    if (k === "specCode" && canonical != null) out.duplicateOf = canonical;
  }
  return out;
}

export function markDuplicates(catalog) {
  const byId = new Map();
  for (const rec of catalog) {
    if (byId.has(rec.specCode)) fail(`specCode ${rec.specCode} appears twice`);
    byId.set(rec.specCode, rec);
  }

  for (const [dupId, [dupName, canonicalId, canonicalName]] of DUPLICATES) {
    const dup = byId.get(dupId);
    const canonical = byId.get(canonicalId);
    if (!dup) fail(`duplicate ${dupId} is not in the catalog`);
    if (dup.scientificName !== dupName) fail(`${dupId} is "${dup.scientificName}", expected "${dupName}"`);
    if (!canonical) fail(`canonical ${canonicalId} for ${dupId} is not in the catalog`);
    if (canonical.scientificName !== canonicalName) {
      fail(`${canonicalId} is "${canonical.scientificName}", expected "${canonicalName}"`);
    }
    if (canonicalId === dupId) fail(`${dupId} cannot be a duplicate of itself`);
    if (DUPLICATES.has(canonicalId)) fail(`canonical ${canonicalId} is itself listed as a duplicate`);
    if (canonical.duplicateOf != null) fail(`canonical ${canonicalId} is itself a duplicate (duplicateOf ${canonical.duplicateOf})`);
  }

  for (const rec of catalog) {
    if (rec.duplicateOf != null && !DUPLICATES.has(rec.specCode)) {
      fail(`${rec.specCode} ${rec.scientificName} has duplicateOf ${rec.duplicateOf} but is not in DUPLICATES`);
    }
  }

  const changes = [];
  const next = catalog.map((rec) => {
    const entry = DUPLICATES.get(rec.specCode);
    const canonical = entry ? entry[1] : null;
    if ((rec.duplicateOf ?? null) !== canonical) {
      changes.push(`${rec.specCode} ${rec.scientificName}: duplicateOf ${rec.duplicateOf ?? "(none)"} -> ${canonical ?? "(none)"}`);
    }
    return withDuplicateOf(rec, canonical);
  });
  return { next, changes };
}

function main() {
  const catalog = JSON.parse(readFileSync(MIRRORS[0], "utf8"));
  const { next, changes } = markDuplicates(catalog);

  console.log(`Catalog: ${catalog.length} records. Duplicates: ${DUPLICATES.size}.`);
  for (const [dupId, [dupName, canonicalId, canonicalName, why]] of DUPLICATES) {
    console.log(`  ${dupId} ${dupName} -> ${canonicalId} ${canonicalName} (${why})`);
  }
  console.log(`Visible species (duplicates hidden): ${catalog.length - DUPLICATES.size}`);
  console.log(changes.length ? `\nChanges:\n  ${changes.join("\n  ")}` : "\nNo record changes.");

  const out = JSON.stringify(next, null, 2);
  const stale = MIRRORS.filter((p) => readFileSync(p, "utf8") !== out);
  if (!WRITE) {
    console.log(`\nDry run. ${stale.length ? "Changes pending; re-run with --write." : "Mirrors already up to date."}`);
    return;
  }
  for (const p of MIRRORS) writeFileSync(p, out);
  console.log(`\nWrote ${MIRRORS.length} mirrors (${stale.length ? "updated" : "unchanged"}). Now run: node scripts/build-species-index.mjs`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
