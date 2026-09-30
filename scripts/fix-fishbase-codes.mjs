#!/usr/bin/env node
/**
 * fix-fishbase-codes.mjs: give every FishBase fish in the catalog its real
 * FishBase SpecCode, in a separate `fishbaseSpecCode` field.
 *
 * Why a separate field: `specCode` is the catalog's own ID. User data keys on
 * it (tank/specimen `speciesId`, listings `species_id`, species_insights
 * `spec_code`, the Dexie species table, /api/species?id=). Many records were
 * numbered by hand (10114-10281, 70003, ...) and those numbers are not FishBase
 * SpecCodes, so links built from `specCode` opened the wrong fish. We never
 * renumber `specCode`; FishBase links use `fishbaseSpecCode` instead.
 *
 * Lookup: exact Genus + Species (first two words of scientificName) against the
 * local FishBase dump, fishbase_species.parquet in the repo root. There is no
 * synonyms table in the local dump. When the name is not found but the catalog
 * number is a FishBase SpecCode for the same epithet (genus moved) or a 1-2
 * letter spelling variant in the same genus, that number is confirmed and used.
 * Failing that, a single same-genus FishBase epithet within 2 letters (gender
 * endings like "aureum" / "aureus") is used.
 * Then MANUAL_MATCHES: genus moves a human checked against the dump (same
 * epithet, same family, parenthesised author = original genus differs). The
 * FishBase name at that code is asserted, so a changed dump fails loudly.
 * Anything else stays unresolved, is listed with same-epithet FishBase
 * candidates for a human to check, and gets no fishbaseSpecCode.
 * Still unresolved on purpose: 70002 Hemigrammus rhodostomus and 70004 Brochis
 * agassizii duplicate 12370 Petitella rhodostoma and 10143 Corydoras agassizii;
 * the catalog has no alias/duplicate mechanism yet, so they are left as is.
 *
 * Not FishBase records (no fishbaseSpecCode): plants (90001-90999, type plant),
 * freshwater inverts (80001-80999, type invertebrate), corals and marine inverts
 * (200001+, WoRMS aphiaId), Supabase-added IDs (100000-199999), amphibians.
 *
 * Also normalizes two data issues (idempotent):
 *   - family " (Plant)" / " (Invertebrate)" / " (Coral)" suffixes are stripped;
 *     `type` carries the kind. Every runtime consumer reads `type` (species.html
 *     only uses the suffix as a fallback when `type` is missing).
 *   - 67133 Neocaridina davidi gets type "invertebrate", 67134 Ambystoma
 *     mexicanum (axolotl) gets type "amphibian"; both had no `type`, so the app
 *     filed them under Fish.
 *
 * Re-runnable. Writes both catalog mirrors byte-identically, then rebuild the
 * homepage index:
 *
 *   node scripts/fix-fishbase-codes.mjs            # report only (dry run)
 *   node scripts/fix-fishbase-codes.mjs --write    # report + write both mirrors
 *   node scripts/build-species-index.mjs
 *
 * Flags: --all prints every row of the table (default: mismatches + unresolved).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parquetRead } from "hyparquet";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIRRORS = [
  `${ROOT}frontend/public/fishbase_master.json`,
  `${ROOT}frontend/fishbase_master.json`,
];
const PARQUET = `${ROOT}fishbase_species.parquet`;

const WRITE = process.argv.includes("--write");
const ALL = process.argv.includes("--all");

const NON_FISH_TYPES = new Set(["plant", "invertebrate", "coral", "amphibian"]);
const NON_FISHBASE_BANDS = [
  [80001, 80999], // hand-assigned freshwater inverts
  [90001, 90999], // hand-assigned plants
  [100000, 199999], // Supabase-added species
  [200001, Infinity], // corals and marine inverts (WoRMS)
];
const FAMILY_SUFFIX = /\s*\((Plant|Invertebrate|Coral)\)$/;
// catalog specCode -> [FishBase SpecCode, FishBase Genus Species at that code]
const MANUAL_MATCHES = new Map([
  [10264, [46840, "Wallaciia compressiceps"]], // Crenicichla compressiceps; FishBase: (Ploeg, 1986), Cichlidae
  [10265, [52192, "Lugubria marmorata"]], // Crenicichla marmorata; FishBase: (Pellegrin, 1904), Cichlidae
]);
const TYPE_FIXES = new Map([
  ["Neocaridina davidi", "invertebrate"],
  ["Ambystoma mexicanum", "amphibian"],
]);

async function loadFishBase() {
  const buf = readFileSync(PARQUET);
  const file = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let rows = [];
  await parquetRead({
    file,
    columns: ["SpecCode", "Genus", "Species"],
    rowFormat: "object",
    onComplete: (d) => { rows = d; },
  });
  const byName = new Map();
  const byCode = new Map();
  const byEpithet = new Map();
  const byGenus = new Map();
  for (const r of rows) {
    const code = Number(r.SpecCode);
    const key = `${r.Genus} ${r.Species}`.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(code);
    byCode.set(code, `${r.Genus} ${r.Species}`);
    const ep = String(r.Species || "").toLowerCase();
    if (!byEpithet.has(ep)) byEpithet.set(ep, []);
    byEpithet.get(ep).push([code, `${r.Genus} ${r.Species}`]);
    const g = String(r.Genus || "").toLowerCase();
    if (!byGenus.has(g)) byGenus.set(g, []);
    byGenus.get(g).push([code, ep]);
  }
  return { byName, byCode, byEpithet, byGenus, count: rows.length };
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/**
 * True when a catalog binomial and a FishBase name are the same species under a
 * genus change (same epithet) or a spelling fix (same genus, epithet within 2
 * edits). Only used to confirm a catalog number that is already a FishBase code.
 */
function sameSpecies(catalogKey, fishbaseName) {
  const [cg, ce] = catalogKey.split(" ");
  const [fg, fe] = fishbaseName.toLowerCase().split(" ");
  if (ce === fe) return true;
  return cg === fg && editDistance(ce, fe) <= 2;
}

/** "Apistogramma borellii Opal" -> "apistogramma borellii"; null for "Genus sp." etc. */
function binomialKey(rec) {
  const words = String(rec.scientificName || "").trim().split(/\s+/);
  if (words.length < 2) return null;
  const [genus, species] = words;
  if (!/^[A-Z][a-z]+$/.test(genus) || !/^[a-z][a-z-]+$/.test(species)) return null;
  if (["sp", "spp", "cf", "aff"].includes(species.replace(/\.$/, ""))) return null;
  return `${genus} ${species}`.toLowerCase();
}

function isFishBaseCandidate(rec) {
  const type = String(rec.type || "").toLowerCase();
  if (NON_FISH_TYPES.has(type)) return false;
  if (Number(rec.marine?.aphiaId) > 0) return false;
  const id = Number(rec.specCode);
  return !NON_FISHBASE_BANDS.some(([lo, hi]) => id >= lo && id <= hi);
}

/** Rebuild the record with fishbaseSpecCode right after specCode (or without it). */
function withFishBaseCode(rec, code) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === "fishbaseSpecCode") continue;
    out[k] = v;
    if (k === "specCode" && code != null) out.fishbaseSpecCode = code;
  }
  return out;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main() {
  const raw = readFileSync(MIRRORS[0], "utf8");
  const catalog = JSON.parse(raw);
  const fb = await loadFishBase();
  console.log(`FishBase species table: ${fb.count} rows. Catalog: ${catalog.length} records.\n`);

  const rows = [];
  const unresolved = [];
  const ambiguous = [];
  const renamed = [];
  const dataFixes = [];

  const next = catalog.map((rec) => {
    let r = rec;

    // Type fixes for records that had no `type`.
    const fixType = TYPE_FIXES.get(r.scientificName);
    if (fixType && r.type !== fixType) {
      dataFixes.push(`${r.specCode} ${r.scientificName}: type ${r.type ?? "(none)"} -> ${fixType}`);
      r = { ...r, type: fixType };
    }
    // Family suffixes: `type` carries the kind.
    if (typeof r.family === "string" && FAMILY_SUFFIX.test(r.family)) {
      const clean = r.family.replace(FAMILY_SUFFIX, "");
      dataFixes.push(`${r.specCode} ${r.scientificName}: family "${r.family}" -> "${clean}"`);
      r = { ...r, family: clean };
    }

    if (!isFishBaseCandidate(r)) return withFishBaseCode(r, null);

    const key = binomialKey(r);
    const codes = key ? fb.byName.get(key) || [] : [];
    let code = null;
    if (codes.length === 1) code = codes[0];
    else if (codes.length > 1) {
      // Prefer the catalog's own number if it is one of them; otherwise lowest.
      code = codes.includes(Number(r.specCode)) ? Number(r.specCode) : Math.min(...codes);
      ambiguous.push(`${r.specCode} ${r.scientificName}: FishBase codes ${codes.join(", ")} (using ${code})`);
    }
    let how = code == null ? "" : "name";
    if (code == null && key) {
      // FishBase moved the species to another genus (or fixed the spelling):
      // the catalog number is the FishBase SpecCode of the same species.
      const idHit = fb.byCode.get(Number(r.specCode));
      if (idHit && sameSpecies(key, idHit)) {
        code = Number(r.specCode);
        how = `code (FishBase name: ${idHit})`;
        renamed.push(`${r.specCode} ${r.scientificName} -> FishBase ${code} ${idHit}`);
      }
    }
    if (code == null && key) {
      // Spelling / gender-ending variant in the same genus ("aureum" vs
      // "aureus"): accept only a single FishBase epithet within 2 edits.
      const [genus, epithet] = key.split(" ");
      const near = (fb.byGenus.get(genus) || []).filter(([, ep]) => editDistance(epithet, ep) <= 2);
      if (near.length === 1) {
        const [nearCode, ep] = near[0];
        code = nearCode;
        const fbName = fb.byCode.get(nearCode);
        how = `spelling (FishBase name: ${fbName})`;
        renamed.push(`${r.specCode} ${r.scientificName} -> FishBase ${code} ${fbName} (spelling: ${epithet} / ${ep})`);
      }
    }
    if (code == null && MANUAL_MATCHES.has(Number(r.specCode))) {
      const [manualCode, expected] = MANUAL_MATCHES.get(Number(r.specCode));
      const fbName = fb.byCode.get(manualCode);
      if (fbName !== expected) {
        throw new Error(`MANUAL_MATCHES ${r.specCode}: FishBase ${manualCode} is "${fbName}", expected "${expected}"`);
      }
      code = manualCode;
      how = `manual (FishBase name: ${fbName})`;
      renamed.push(`${r.specCode} ${r.scientificName} -> FishBase ${code} ${fbName} (manual)`);
    }
    const mismatch = code == null ? null : code !== Number(r.specCode);
    rows.push({ specCode: r.specCode, name: r.scientificName, mismatch, code, how });
    if (code == null) {
      const idHit = fb.byCode.get(Number(r.specCode));
      const epithet = key ? key.split(" ")[1] : "";
      const candidates = epithet ? fb.byEpithet.get(epithet) || [] : [];
      unresolved.push(`${r.specCode} ${r.scientificName}`
        + (idHit ? `; catalog number is FishBase ${r.specCode} = ${idHit}` : "")
        + (candidates.length ? `; same epithet in FishBase: ${candidates.slice(0, 6).map(([c, n]) => `${c} ${n}`).join(", ")}` : ""));
    }
    return withFishBaseCode(r, code);
  });

  // Table: catalog specCode | scientificName | old mismatch? | fishbaseSpecCode
  const shown = ALL ? rows : rows.filter((x) => x.mismatch !== false || x.how !== "name");
  console.log(`${pad("specCode", 9)} | ${pad("scientificName", 38)} | ${pad("mismatch", 8)} | fishbaseSpecCode`);
  console.log(`${"-".repeat(9)}-+-${"-".repeat(38)}-+-${"-".repeat(8)}-+-${"-".repeat(16)}`);
  for (const x of shown) {
    const mm = x.mismatch == null ? "?" : x.mismatch ? "yes" : "no";
    const note = x.how && x.how !== "name" ? `  matched by ${x.how}` : "";
    console.log(`${pad(x.specCode, 9)} | ${pad(x.name, 38)} | ${pad(mm, 8)} | ${x.code ?? "(unresolved)"}${note}`);
  }
  if (!ALL) console.log(`(${rows.length - shown.length} matching rows hidden; --all shows them)`);

  const matched = rows.filter((x) => x.mismatch === false).length;
  const mismatched = rows.filter((x) => x.mismatch === true).length;
  const skipped = catalog.length - rows.length;
  console.log(`\nSummary:
  FishBase candidates:            ${rows.length}
    specCode already = FishBase:  ${matched}
    specCode != FishBase (fixed): ${mismatched}
    (of these, under a different FishBase name: ${renamed.length})
    not found in FishBase:        ${unresolved.length}
  not FishBase records (skipped): ${skipped}
  with fishbaseSpecCode:          ${matched + mismatched}`);
  if (renamed.length) console.log(`\nMatched under a different FishBase name (genus move or spelling):\n  ${renamed.join("\n  ")}`);
  if (ambiguous.length) console.log(`\nAmbiguous names:\n  ${ambiguous.join("\n  ")}`);
  if (unresolved.length) console.log(`\nUnresolved (no fishbaseSpecCode):\n  ${unresolved.join("\n  ")}`);
  if (dataFixes.length) console.log(`\nData fixes:\n  ${dataFixes.join("\n  ")}`);

  const out = JSON.stringify(next, null, 2);
  const changed = MIRRORS.some((p) => readFileSync(p, "utf8") !== out);
  if (!WRITE) {
    console.log(`\nDry run. ${changed ? "Changes pending; re-run with --write." : "Mirrors already up to date."}`);
    return;
  }
  for (const p of MIRRORS) writeFileSync(p, out);
  console.log(`\nWrote ${MIRRORS.length} mirrors (${changed ? "updated" : "unchanged"}). Now run: node scripts/build-species-index.mjs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
