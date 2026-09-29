/**
 * add-reef-batch.mjs — the first reef corals and marine invertebrates in the
 * Aquadex (docs/SALTWATER_SPEC.md, "Next: corals and inverts").
 *
 * Corals and inverts are not in FishBase, so taxonomy comes from WoRMS (the
 * World Register of Marine Species). The data lives in
 * scripts/data/reef-corals-inverts.json: every entry carries the AphiaID and
 * family of its WoRMS *accepted* record, looked up ahead of time, plus
 * hand-curated reef-keeping care values. This script does no network calls.
 *
 * Guards (any failure refuses the whole batch):
 *   - both catalog mirrors must be identical;
 *   - every entry has the required fields and only allowed enum values;
 *   - no scientificName (or older trade name in soldAs) already in the catalog;
 *   - no duplicate names or AphiaIDs inside the batch;
 *   - IDs come from a dedicated band starting at 200001 (FishBase codes sit
 *     below 100000 and the Supabase species_profiles sequence uses
 *     100000–199999), and none may already exist in the catalog.
 *
 * Usage: node scripts/add-reef-batch.mjs [--write]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC_PATH = resolve(ROOT, 'frontend/public/fishbase_master.json');
const ROOT_PATH = resolve(ROOT, 'frontend/fishbase_master.json');
const DATA_PATH = resolve(import.meta.dirname, 'data/reef-corals-inverts.json');
const WRITE = process.argv.includes('--write');

const ID_BAND_START = 200001;
const RESERVED_BAND = [100000, 199999]; // Supabase species_profiles local sequence

const DIFFICULTY = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
const CORAL_ENUMS = {
  coralType: ['SPS', 'LPS', 'soft', 'zoanthid', 'mushroom', 'anemone', 'gorgonian'],
  light: ['low', 'medium', 'high'],
  flow: ['low', 'medium', 'high'],
  placement: ['bottom', 'middle', 'top', 'any'],
  aggression: ['peaceful', 'semi-aggressive', 'aggressive'],
  feeding: ['photosynthetic', 'photosynthetic + target feed', 'non-photosynthetic'],
};
const INVERT_ENUMS = {
  reefSafe: ['yes', 'with caution', 'no'],
  role: ['cleanup crew', 'cleaner', 'display', 'filter feeder'],
};
// Matches the existing catalog convention, e.g. "Physidae (Invertebrate)".
const FAMILY_SUFFIX = { coral: 'Coral', invertebrate: 'Invertebrate' };

const CORAL_TYPE_LABEL = {
  SPS: 'Small-polyp stony coral (SPS)', LPS: 'Large-polyp stony coral (LPS)', soft: 'Soft coral',
  zoanthid: 'Zoanthid', mushroom: 'Mushroom coral (corallimorph)', anemone: 'Anemone', gorgonian: 'Gorgonian',
};
const PLACEMENT_PHRASE = { bottom: 'low in the tank', middle: 'mid-rockwork', top: 'high on the rockwork', any: 'anywhere in the tank' };
const AGGRESSION_LINE = {
  peaceful: 'Peaceful toward neighbors.',
  'semi-aggressive': 'Can sting or crowd close neighbors, so leave some space.',
  aggressive: 'Has a strong sting or sweeper tentacles, so give it plenty of space.',
};
const REEF_LINE = { yes: 'Reef safe.', 'with caution': 'Reef safe with caution.', no: 'Not reef safe.' };

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isPositive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isRange = (v, lo, hi) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= lo && n <= hi) && v[0] < v[1];
const fmtRange = ([a, b]) => `${a}–${b}`;

function validateEntry(entry, kind, defaults, problems) {
  const label = entry?.scientificName || `(unnamed ${kind})`;
  const bad = (msg) => problems.push(`${label}: ${msg}`);
  if (!/^[A-Z][a-z]+ [a-z]+$/.test(entry.scientificName || '')) bad('scientificName must be an accepted binomial "Genus species"');
  for (const key of ['commonName', 'family', 'note', 'comments']) if (!isNonEmptyString(entry[key])) bad(`missing ${key}`);
  if (!Number.isInteger(entry.aphiaId) || entry.aphiaId <= 0) bad('aphiaId must be a positive integer');
  if (entry.maxLengthCm !== null && !isPositive(entry.maxLengthCm)) bad('maxLengthCm must be a positive number or null');
  if (!isPositive(entry.minVolumeGallons)) bad('minVolumeGallons must be a positive number');
  if (!DIFFICULTY.includes(entry.difficulty)) bad(`difficulty "${entry.difficulty}" not in ${DIFFICULTY.join('|')}`);
  if (!isRange(entry.tempRangeCelsius ?? defaults.tempRangeCelsius, 18, 32)) bad('tempRangeCelsius must be [low, high] within 18–32 °C');
  if (!isRange(entry.phRange ?? defaults.phRange, 7.5, 8.8)) bad('phRange must be [low, high] within 7.5–8.8');
  if (entry.soldAs !== undefined && !(Array.isArray(entry.soldAs) && entry.soldAs.every(isNonEmptyString))) bad('soldAs must be an array of names');
  if (entry.taxonomyNote !== undefined && !isNonEmptyString(entry.taxonomyNote)) bad('taxonomyNote must be a non-empty string when present');
  const enums = kind === 'coral' ? CORAL_ENUMS : INVERT_ENUMS;
  for (const [key, allowed] of Object.entries(enums)) {
    if (!allowed.includes(entry[key])) bad(`${key} "${entry[key]}" not in ${allowed.join('|')}`);
  }
  if (kind === 'invertebrate' && !isNonEmptyString(entry.notes)) bad('missing notes');
}

function buildRecord(entry, kind, specCode, defaults) {
  const [genus, species] = entry.scientificName.split(' ');
  const tempRangeCelsius = entry.tempRangeCelsius ?? defaults.tempRangeCelsius;
  const phRange = entry.phRange ?? defaults.phRange;
  const wormsUrl = `https://www.marinespecies.org/aphia.php?p=taxdetails&id=${entry.aphiaId}`;
  const careLine = `${fmtRange(tempRangeCelsius)} °C, pH ${fmtRange(phRange)}, ${entry.minVolumeGallons} gal minimum`;
  const taxonomy = entry.taxonomyNote ? ` ${entry.taxonomyNote}` : '';
  const provenance = 'Taxonomy from WoRMS; care values are curated reef-keeping guidance, not FishBase.';

  let marine;
  let vibePro;
  let flavorCasual;
  let flavorPro;
  if (kind === 'coral') {
    marine = {
      reefSafe: 'yes', requiresReef: true, aphiaId: entry.aphiaId,
      coralType: entry.coralType, light: entry.light, flow: entry.flow, placement: entry.placement,
      aggression: entry.aggression, feeding: entry.feeding,
    };
    vibePro = `${entry.scientificName}; ${entry.family}. ${CORAL_TYPE_LABEL[entry.coralType]}: ${entry.light} light, ${entry.flow} flow, ${entry.placement} placement.`;
    flavorCasual = `${entry.note} Give it ${entry.light} light and ${entry.flow} flow, placed ${PLACEMENT_PHRASE[entry.placement]}. ${AGGRESSION_LINE[entry.aggression]}`;
    flavorPro = `${entry.scientificName} (${entry.family}, WoRMS AphiaID ${entry.aphiaId}).${taxonomy} ${CORAL_TYPE_LABEL[entry.coralType]}; ${entry.light} light, ${entry.flow} flow, ${entry.placement} placement, ${entry.aggression}, ${entry.feeding}. Husbandry: ${careLine}. ${provenance}`;
  } else {
    marine = { reefSafe: entry.reefSafe, requiresReef: false, aphiaId: entry.aphiaId, role: entry.role, notes: entry.notes };
    vibePro = `${entry.scientificName}; marine ${entry.family}. ${entry.role[0].toUpperCase()}${entry.role.slice(1)}. ${REEF_LINE[entry.reefSafe]}`;
    flavorCasual = `${entry.note} ${REEF_LINE[entry.reefSafe]} ${entry.notes}`;
    flavorPro = `${entry.scientificName} (${entry.family}, WoRMS AphiaID ${entry.aphiaId}).${taxonomy} Role: ${entry.role}. ${REEF_LINE[entry.reefSafe]} Husbandry: ${careLine}. ${provenance}`;
  }

  return {
    specCode,
    scientificName: entry.scientificName,
    genus,
    species,
    commonName: entry.commonName,
    family: `${entry.family} (${FAMILY_SUFFIX[kind]})`,
    type: kind,
    maxLengthCm: entry.maxLengthCm,
    masterPhotoUrl: '',
    tankMetrics: {
      minVolumeGallons: entry.minVolumeGallons,
      tempRangeCelsius: [...tempRangeCelsius],
      phRange: [...phRange],
      difficulty: entry.difficulty,
    },
    waterTypes: ['marine'],
    waterTypesSource: 'worms',
    marine,
    sources: [{ name: 'WoRMS', url: wormsUrl, type: 'Taxonomy' }],
    ecology: { comments: entry.comments, phMin: phRange[0], phMax: phRange[1] },
    personality: {
      vibeLine: { casual: entry.note, pro: vibePro },
      flavorText: { casual: flavorCasual, pro: flavorPro },
    },
  };
}

function main() {
  const catalog = JSON.parse(readFileSync(PUBLIC_PATH, 'utf8'));
  const mirror = JSON.parse(readFileSync(ROOT_PATH, 'utf8'));
  if (JSON.stringify(catalog) !== JSON.stringify(mirror)) throw new Error('Catalog mirrors differ; reconcile them first.');
  if (!Array.isArray(catalog)) throw new Error('Catalog is not a JSON array.');

  const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  const defaults = data.careDefaults || {};
  const entries = [
    ...(data.corals || []).map((e) => ({ entry: e, kind: 'coral' })),
    ...(data.inverts || []).map((e) => ({ entry: e, kind: 'invertebrate' })),
  ];
  if (!entries.length) throw new Error('No entries in the data file.');

  const existingCodes = new Set(catalog.map((r) => Number(r.specCode)));
  const existingNames = new Set(catalog.map((r) => String(r.scientificName).toLowerCase()));
  const problems = [];
  const seenNames = new Set();
  const seenAphia = new Set();

  entries.forEach(({ entry, kind }) => {
    validateEntry(entry, kind, defaults, problems);
    for (const name of [entry.scientificName, ...(entry.soldAs || [])]) {
      const key = String(name).toLowerCase();
      if (existingNames.has(key)) problems.push(`already in catalog: ${name}${name !== entry.scientificName ? ` (older name of ${entry.scientificName})` : ''}`);
      if (seenNames.has(key)) problems.push(`duplicate name in batch: ${name}`);
      seenNames.add(key);
    }
    if (seenAphia.has(entry.aphiaId)) problems.push(`duplicate aphiaId in batch: ${entry.aphiaId} (${entry.scientificName})`);
    seenAphia.add(entry.aphiaId);
  });

  const additions = entries.map(({ entry, kind }, i) => {
    const specCode = ID_BAND_START + i;
    if (specCode >= RESERVED_BAND[0] && specCode <= RESERVED_BAND[1]) problems.push(`ID ${specCode} falls in the reserved ${RESERVED_BAND.join('–')} band`);
    if (existingCodes.has(specCode)) problems.push(`ID already in catalog: ${specCode} (${entry.scientificName})`);
    return problems.length ? null : buildRecord(entry, kind, specCode, defaults);
  });
  if (problems.length) throw new Error(`Refusing to write:\n  ${problems.join('\n  ')}`);

  const corals = additions.filter((a) => a.type === 'coral').length;
  console.log(JSON.stringify({
    source: data._source,
    reviewedBy: data._reviewedBy,
    added: additions.length,
    corals,
    inverts: additions.length - corals,
    idRange: `${additions[0].specCode}–${additions[additions.length - 1].specCode}`,
    catalogBefore: catalog.length,
    catalogAfter: catalog.length + additions.length,
  }, null, 2));
  console.table(additions.map((a) => ({
    id: a.specCode,
    scientificName: a.scientificName,
    commonName: a.commonName,
    type: a.type,
    kind: a.marine.coralType || a.marine.role,
    aphiaId: a.marine.aphiaId,
    family: a.family,
    care: a.type === 'coral' ? `${a.marine.light}/${a.marine.flow}/${a.marine.placement}` : `reefSafe: ${a.marine.reefSafe}`,
  })));

  if (!WRITE) { console.log('Dry run. Re-run with --write to save.'); return; }
  const serialized = JSON.stringify([...catalog, ...additions], null, 2);
  writeFileSync(PUBLIC_PATH, serialized, 'utf8');
  writeFileSync(ROOT_PATH, serialized, 'utf8');
  console.log('Wrote both catalog mirrors.');
}

try { main(); } catch (e) { console.error(e.message || e); process.exit(1); }
