/**
 * apply-marine-care.mjs — curated care ranges for the marine batch
 * (docs/SALTWATER_SPEC.md, scripts/add-marine-batch.mjs).
 *
 * The marine records were added with `tankMetrics: { difficulty: "Unknown" }`
 * because FishBase has no aquarium care ranges. This script fills them in from
 * scripts/data/marine-care.json, a hand-curated file of widely published
 * husbandry guidance (see its `_source` / `_reviewedBy` fields).
 *
 * Guards:
 *   - both catalog mirrors must be identical;
 *   - every marine record (waterTypes includes "marine") must have an entry,
 *     and every entry must name an existing marine record;
 *   - every value is range-checked (temp 18–30 °C in half degrees, pH 7.5–8.8
 *     to one decimal, min < max, 5–500 whole gallons, a difficulty string that
 *     speciesCatalog.js normalizeDifficulty recognizes);
 *   - after building, only tankMetrics, behavior and careSource may differ on
 *     any record.
 *
 * Per marine record it sets tankMetrics.tempRangeCelsius / phRange /
 * minVolumeGallons / difficulty, merges { temperament, swimmingLevel, notes }
 * into behavior, and sets careSource: "curated". Nothing else is touched.
 *
 * Usage: node scripts/apply-marine-care.mjs [--write]
 *   Without --write it only reports what it would change.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC_PATH = resolve(ROOT, 'frontend/public/fishbase_master.json');
const ROOT_PATH = resolve(ROOT, 'frontend/fishbase_master.json');
const DATA_PATH = resolve(ROOT, 'scripts/data/marine-care.json');
const WRITE = process.argv.includes('--write');

// Difficulty strings already used in the catalog that normalizeDifficulty
// (frontend/src/services/speciesCatalog.js) maps to a real tier.
const DIFFICULTIES = new Set(['Beginner', 'Intermediate', 'Advanced', 'Difficult', 'Expert']);
const ENTRY_KEYS = ['tempRangeCelsius', 'phRange', 'minVolumeGallons', 'difficulty', 'temperament', 'swimmingLevel', 'notes'];
const TANK_KEYS = ['tempRangeCelsius', 'phRange', 'minVolumeGallons', 'difficulty'];
const MUTABLE_KEYS = new Set(['tankMetrics', 'behavior', 'careSource']);

// Marine FISH from FishBase (scripts/add-marine-batch.mjs). Corals and inverts
// (waterTypesSource "worms", scripts/add-reef-batch.mjs) carry their own care.
const isMarine = (r) => Array.isArray(r.waterTypes) && r.waterTypes.includes('marine') && r.waterTypesSource === 'fishbase';
const isStep = (v, step) => Math.abs(Math.round(v / step) * step - v) < 1e-9;
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

function checkRange(name, label, range, lo, hi, step, problems) {
  if (!Array.isArray(range) || range.length !== 2 || !range.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    problems.push(`${name}: ${label} must be [min, max] numbers`);
    return;
  }
  const [min, max] = range;
  if (min < lo || max > hi) problems.push(`${name}: ${label} [${min}, ${max}] outside ${lo}–${hi}`);
  if (!(min < max)) problems.push(`${name}: ${label} min ${min} is not below max ${max}`);
  if (!isStep(min, step) || !isStep(max, step)) problems.push(`${name}: ${label} [${min}, ${max}] not in steps of ${step}`);
}

function validateEntry(name, entry, problems) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { problems.push(`${name}: entry is not an object`); return; }
  const keys = Object.keys(entry);
  for (const k of ENTRY_KEYS) if (!keys.includes(k)) problems.push(`${name}: missing ${k}`);
  for (const k of keys) if (!ENTRY_KEYS.includes(k)) problems.push(`${name}: unexpected key ${k}`);
  checkRange(name, 'tempRangeCelsius', entry.tempRangeCelsius, 18, 30, 0.5, problems);
  checkRange(name, 'phRange', entry.phRange, 7.5, 8.8, 0.1, problems);
  const gal = entry.minVolumeGallons;
  if (!Number.isInteger(gal) || gal < 5 || gal > 500) problems.push(`${name}: minVolumeGallons ${gal} must be a whole number 5–500`);
  if (!DIFFICULTIES.has(entry.difficulty)) problems.push(`${name}: unknown difficulty "${entry.difficulty}"`);
  for (const k of ['temperament', 'swimmingLevel', 'notes']) if (!nonEmpty(entry[k])) problems.push(`${name}: ${k} must be a non-empty string`);
}

function applyEntry(record, entry) {
  const existingTank = record.tankMetrics && typeof record.tankMetrics === 'object' ? record.tankMetrics : {};
  const otherTank = Object.fromEntries(Object.entries(existingTank).filter(([k]) => !TANK_KEYS.includes(k)));
  const existingBehavior = record.behavior && typeof record.behavior === 'object' ? record.behavior : {};
  return {
    ...record,
    tankMetrics: {
      tempRangeCelsius: [...entry.tempRangeCelsius],
      phRange: [...entry.phRange],
      minVolumeGallons: entry.minVolumeGallons,
      difficulty: entry.difficulty,
      ...otherTank,
    },
    behavior: {
      ...existingBehavior,
      temperament: entry.temperament,
      swimmingLevel: entry.swimmingLevel,
      notes: entry.notes,
    },
    careSource: 'curated',
  };
}

function main() {
  const catalog = JSON.parse(readFileSync(PUBLIC_PATH, 'utf8'));
  const mirror = JSON.parse(readFileSync(ROOT_PATH, 'utf8'));
  if (JSON.stringify(catalog) !== JSON.stringify(mirror)) throw new Error('Catalog mirrors differ; reconcile them first.');
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

  const problems = [];
  if (!nonEmpty(data._source)) problems.push('data file is missing _source');
  if (!nonEmpty(data._reviewedBy)) problems.push('data file is missing _reviewedBy');
  const entries = Object.entries(data).filter(([k]) => !k.startsWith('_'));

  const byName = new Map();
  const nameCounts = new Map();
  for (const r of catalog) {
    const n = String(r.scientificName || '');
    nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
    if (!byName.has(n)) byName.set(n, r);
  }
  const marineNames = catalog.filter(isMarine).map((r) => r.scientificName);
  for (const n of marineNames) if (nameCounts.get(n) > 1) problems.push(`duplicate scientificName in catalog: ${n}`);

  for (const n of marineNames) if (!Object.hasOwn(data, n)) problems.push(`no care entry for marine record: ${n}`);
  for (const [n, entry] of entries) {
    const rec = byName.get(n);
    if (!rec) problems.push(`entry names a record not in the catalog: ${n}`);
    else if (!isMarine(rec)) problems.push(`entry names a non-marine record: ${n}`);
    validateEntry(n, entry, problems);
  }
  if (problems.length) throw new Error(`Refusing to apply:\n  ${problems.join('\n  ')}`);

  let changed = 0;
  let alreadyCurated = 0;
  const updated = catalog.map((record) => {
    if (!isMarine(record)) return record;
    if (record.careSource === 'curated') alreadyCurated += 1;
    const next = applyEntry(record, data[record.scientificName]);
    if (JSON.stringify(next) !== JSON.stringify(record)) changed += 1;
    return next;
  });

  // Nothing outside tankMetrics / behavior / careSource may change.
  updated.forEach((next, i) => {
    const prev = catalog[i];
    for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      if (MUTABLE_KEYS.has(k)) continue;
      if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) problems.push(`unexpected change to ${k} on ${prev.scientificName}`);
    }
    if (!isMarine(prev) && next !== prev) problems.push(`non-marine record touched: ${prev.scientificName}`);
  });
  if (problems.length) throw new Error(`Refusing to apply:\n  ${problems.join('\n  ')}`);

  const rows = updated.filter(isMarine).map((r) => {
    const t = r.tankMetrics;
    return `${r.scientificName.padEnd(28)} ${`${t.tempRangeCelsius[0]}-${t.tempRangeCelsius[1]}C`.padEnd(10)} ${`pH ${t.phRange[0]}-${t.phRange[1]}`.padEnd(13)} ${`${t.minVolumeGallons} gal`.padEnd(8)} ${t.difficulty.padEnd(12)} ${r.behavior.temperament}`;
  });
  console.log(JSON.stringify({
    records: catalog.length,
    marineRecords: marineNames.length,
    entries: entries.length,
    changed,
    alreadyCurated,
    source: data._source,
    reviewedBy: data._reviewedBy,
  }, null, 2));
  console.log(rows.join('\n'));
  if (data._reviewedBy === 'pending') console.log('Note: _reviewedBy is still "pending".');
  if (!WRITE) { console.log('Dry run. Re-run with --write to save.'); return; }
  const serialized = JSON.stringify(updated, null, 2);
  writeFileSync(PUBLIC_PATH, serialized, 'utf8');
  writeFileSync(ROOT_PATH, serialized, 'utf8');
  console.log(`Wrote ${PUBLIC_PATH} and ${ROOT_PATH}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
