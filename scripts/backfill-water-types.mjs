/**
 * backfill-water-types.mjs
 *
 * Adds `waterTypes` (["freshwater" | "brackish" | "marine", ...]) to every
 * record in both catalog mirrors, from FishBase's Fresh / Brack / Saltwater
 * flags (docs/SALTWATER_SPEC.md). A record is matched to FishBase by its
 * scientific name; a SpecCode is trusted only if its FishBase name agrees,
 * because some catalog codes were hand-assigned and overlap real SpecCodes.
 *
 * Records FishBase doesn't know (plants, inverts, hand-added entries) keep the
 * catalog's curated freshwater scope and are marked `waterTypesSource:
 * "curated"`, so it's clear the value didn't come from FishBase.
 *
 * Usage: node scripts/backfill-water-types.mjs [--write]
 *   Without --write it only reports what it would change.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parquetRead } from 'hyparquet';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC_PATH = resolve(ROOT, 'frontend/public/fishbase_master.json');
const ROOT_PATH = resolve(ROOT, 'frontend/fishbase_master.json');
const WRITE = process.argv.includes('--write');

function getArrayBuffer(filePath) {
  const buffer = readFileSync(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function loadSpecies() {
  let rows = [];
  await parquetRead({
    file: getArrayBuffer(resolve(ROOT, 'fishbase_species.parquet')),
    columns: ['SpecCode', 'Genus', 'Species', 'Fresh', 'Brack', 'Saltwater'],
    rowFormat: 'object',
    onComplete: (data) => { rows = data; },
  });
  return rows;
}

/** FishBase marks a habitat with -1 or 1; 0 or null means no. */
const flag = (v) => Number(v) === -1 || Number(v) === 1;

export function waterTypesFromFishBase(row) {
  const out = [];
  if (flag(row.Fresh)) out.push('freshwater');
  if (flag(row.Brack)) out.push('brackish');
  if (flag(row.Saltwater)) out.push('marine');
  return out;
}

async function main() {
  const catalog = JSON.parse(readFileSync(PUBLIC_PATH, 'utf8'));
  const mirror = JSON.parse(readFileSync(ROOT_PATH, 'utf8'));
  if (JSON.stringify(catalog) !== JSON.stringify(mirror)) throw new Error('Catalog mirrors differ; reconcile them first.');

  const rows = await loadSpecies();
  const byName = new Map(rows.map((r) => [`${r.Genus} ${r.Species}`.toLowerCase(), r]));
  const byCode = new Map(rows.map((r) => [Number(r.SpecCode), r]));

  const tally = { fishbase: 0, curated: 0, marine: 0, brackish: 0, freshwaterOnly: 0, codeNameMismatch: 0 };
  const marineNames = [];
  const updated = catalog.map((record) => {
    const name = String(record.scientificName || '').toLowerCase();
    let row = byName.get(name);
    if (!row) {
      const coded = byCode.get(Number(record.specCode));
      if (coded && `${coded.Genus} ${coded.Species}`.toLowerCase() === name) row = coded;
      else if (coded) tally.codeNameMismatch += 1;
    }
    let waterTypes = row ? waterTypesFromFishBase(row) : [];
    let source = 'fishbase';
    if (!waterTypes.length) {
      waterTypes = ['freshwater'];
      source = 'curated';
    }
    tally[source] += 1;
    if (waterTypes.includes('marine')) { tally.marine += 1; marineNames.push(record.scientificName); }
    if (waterTypes.includes('brackish')) tally.brackish += 1;
    if (waterTypes.length === 1 && waterTypes[0] === 'freshwater') tally.freshwaterOnly += 1;
    return { ...record, waterTypes, waterTypesSource: source };
  });

  console.log(JSON.stringify({ records: updated.length, ...tally, marineNames }, null, 2));
  if (!WRITE) {
    console.log('Dry run. Re-run with --write to save.');
    return;
  }
  const serialized = JSON.stringify(updated, null, 2);
  writeFileSync(PUBLIC_PATH, serialized, 'utf8');
  writeFileSync(ROOT_PATH, serialized, 'utf8');
  console.log(`Wrote ${PUBLIC_PATH} and ${ROOT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
