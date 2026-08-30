/**
 * add-corydoras-batch.mjs
 *
 * Adds a curated Callichthyidae batch to both canonical catalogs using local
 * FishBase parquet data. Missing care and breeding facts remain explicit rather
 * than being inferred from genus-level assumptions.
 *
 * Usage: node scripts/add-corydoras-batch.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parquetRead } from 'hyparquet';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC_PATH = resolve(ROOT, 'frontend/public/fishbase_master.json');
const ROOT_PATH = resolve(ROOT, 'frontend/fishbase_master.json');
const FAMILY = 'Callichthyidae';

const selectedNames = [
  'Corydoras simulatus',
  'Corydoras axelrodi',
  'Corydoras baderi',
  'Corydoras ehrhardti',
  'Corydoras melanistius',
  'Corydoras nanus',
  'Corydoras punctatus',
  'Corydoras reticulatus',
  'Corydoras septentrionalis',
  'Corydoras splendens',
  'Corydoras melanotaenia',
  'Corydoras acrensis',
  'Corydoras acutus',
  'Corydoras amapaensis',
  'Corydoras benattii',
  'Aspidoras albater',
  'Aspidoras fuscoguttatus',
  'Aspidoras pauciradiatus',
  'Aspidoras raimundi',
  'Scleromystax barbatus',
];

const personalityNotes = {
  'Corydoras simulatus': ['The Olga cory is a small current-loving bottom explorer.', 'Corydoras simulatus; FishBase reports clean, clear flowing water preference and an aquarium spawning observation.'],
  'Corydoras axelrodi': ['A pink cory with a gentle community-tank rhythm.', 'Corydoras axelrodi; compact commercial cory with FishBase brood-hider reproductive data.'],
  'Corydoras baderi': ['The Road cory is a quiet specialist from the upper reaches of rivers.', 'Corydoras baderi; commercial freshwater cory with limited biology notes but a FishBase reproductive record.'],
  'Corydoras ehrhardti': ['An olive cory that hunts tiny insect larvae along the bottom.', 'Corydoras ehrhardti; small freshwater cory with insect-larva feeding noted in FishBase.'],
  'Corydoras melanistius': ['The bluespotted cory brings a classic armored-catfish look to the group.', 'Corydoras melanistius; commercial cory with explicit diet, brood-hider guild, and high aquarium-breeding rating.'],
  'Corydoras nanus': ['A rare little cory for keepers who enjoy the edges of the catalog.', 'Corydoras nanus; compact commercial cory with a documented shallow, sandy creek habitat.'],
  'Corydoras punctatus': ['The Spotfin cory wears its habitat on its pattern: darker bottoms, more spots.', 'Corydoras punctatus; commercial cory with source-backed substrate variation and marked male fin dimorphism.'],
  'Corydoras reticulatus': ['The reticulated cory is a patterned forager with a well-documented aquarium breeding flag.', 'Corydoras reticulatus; commercial cory with explicit omnivorous diet and high aquarium-breeding rating in FishBase.'],
  'Corydoras septentrionalis': ['A spring-water cory for a carefully researched specialist setup.', 'Corydoras septentrionalis; freshwater cory associated with flowing spring habitat and a FishBase brood-hider guild.'],
  'Corydoras splendens': ['The Emerald catfish is the large, planted-water showpiece of this batch.', 'Corydoras splendens; large commercial cory from sluggish, vegetated waters with insect-larva and crustacean feeding recorded.'],
  'Corydoras melanotaenia': ['The Green gold catfish comes with an unusually useful spawning observation.', 'Corydoras melanotaenia; commercial cory with FishBase aquarium spawning observation at 23–25°C and recorded fecundity.'],
  'Corydoras acrensis': ['A tiny Acre cory that keeps the bottom layer busy without taking over the tank.', 'Corydoras acrensis; small commercial cory with FishBase freshwater and brood-hider reproductive data.'],
  'Corydoras acutus': ['The Blacktop cory is a compact, commercial species for a carefully chosen group.', 'Corydoras acutus; commercial Corydoras with FishBase brood-hider reproductive data and limited additional notes.'],
  'Corydoras amapaensis': ['The Amapa cory comes from flowing sandy creeks above the rapids.', 'Corydoras amapaensis; commercial freshwater cory with source-backed flowing-creek habitat and omnivory notes.'],
  'Corydoras benattii': ['A tiny Speckled xingu cory from muddy-brown forest streams and marginal ponds.', 'Corydoras benattii; recently catalogued specialist cory with a source-backed lotic and blackwater habitat profile.'],
  'Aspidoras albater': ['The False macropterus is a daytime-active mini catfish for the specialist list.', 'Aspidoras albater; commercial freshwater Aspidoras with diurnal activity and external fertilization recorded in FishBase.'],
  'Aspidoras fuscoguttatus': ['The Darkspotted catfish is a small, uncommon daytime bottom dweller.', 'Aspidoras fuscoguttatus; rare freshwater Aspidoras with FishBase diurnal behavior and limited breeding data.'],
  'Aspidoras pauciradiatus': ['The Sixray corydoras proves a schooling catfish can stay truly tiny.', 'Aspidoras pauciradiatus; commercial nano-sized Aspidoras with schooling behavior recorded in FishBase.'],
  'Aspidoras raimundi': ['The Ceara bulldog cory is a small creek specialist with a memorable silhouette.', 'Aspidoras raimundi; rare freshwater Aspidoras recorded from creeks with limited local breeding data.'],
  'Scleromystax barbatus': ['The Banded corydoras is the big, whiskered anchor of this Callichthyidae batch.', 'Scleromystax barbatus; large commercial Callichthyid with FishBase brood-hider reproductive data.'],
};

function getArrayBuffer(filePath) {
  const buffer = readFileSync(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function loadParquet(name, columns) {
  const filePath = resolve(ROOT, `fishbase_${name}.parquet`);
  let rows = [];
  await parquetRead({
    file: getArrayBuffer(filePath),
    columns,
    rowFormat: 'object',
    onComplete: data => { rows = data; },
  });
  return rows;
}

function clean(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstByCode(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.SpecCode)) map.set(row.SpecCode, row);
  }
  return map;
}

function trophicLabel(value) {
  if (value == null) return null;
  if (value < 2.8) return 'Herbivore / Detritivore';
  if (value < 3.8) return 'Omnivore';
  return 'Carnivore / Piscivore';
}

function roundedLength(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function buildBreeding(repro, spawn) {
  const guild = [repro?.RepGuild1, repro?.RepGuild2]
    .filter(Boolean)
    .map(clean)
    .join('; ');
  let spawningTrait = 'Breeding details are not reported in the local FishBase extract; manual specialist review is required.';

  if (guild) {
    spawningTrait = `FishBase reproductive guild: ${guild}.`;
  } else if (repro?.ReproMode || repro?.Fertilization) {
    spawningTrait = `FishBase records ${clean(repro.ReproMode || 'sexual reproduction')}${repro.Fertilization ? ` with ${clean(repro.Fertilization)} fertilization` : ''}.`;
  }

  const spawnDetails = [
    spawn?.Spawningarea ? `Spawning area: ${clean(spawn.Spawningarea)}.` : '',
    spawn?.TempLow != null || spawn?.TempHigh != null
      ? `Recorded spawning temperature: ${spawn.TempLow ?? '—'}–${spawn.TempHigh ?? '—'}°C.`
      : '',
    spawn?.FecundityMin != null || spawn?.FecundityMax != null
      ? `Recorded fecundity: ${spawn.FecundityMin ?? '—'}–${spawn.FecundityMax ?? '—'}.`
      : '',
  ].filter(Boolean).join(' ');

  const reproductiveDetails = [
    repro?.ReproMode ? `Reproductive mode: ${clean(repro.ReproMode)}.` : '',
    repro?.Fertilization ? `Fertilization: ${clean(repro.Fertilization)}.` : '',
    guild ? `Guild: ${guild}.` : '',
    repro?.ParentalCare ? `Parental care: ${clean(repro.ParentalCare)}.` : '',
    repro?.RepAquarium ? `FishBase aquarium-breeding rating: ${clean(repro.RepAquarium)}.` : '',
  ].filter(Boolean).join(' ');

  return {
    spawningTrait,
    layoutRequirement: guild
      ? 'FishBase identifies a brood-hider reproductive guild; confirm the species-specific egg-deposition setup with specialist breeder guidance.'
      : 'Species-specific spawning layout is not reported in the local extract; specialist review is required before presenting a breeding setup.',
    comments: [reproductiveDetails, spawnDetails].filter(Boolean).join(' ') || 'FishBase has limited breeding notes for this species.',
  };
}

function buildDiet(species, estimate, ecology, foodRows) {
  const foodNames = [...new Set(foodRows
    .map(row => clean(row.Foodname || row.FoodIII || row.FoodII || row.FoodI))
    .filter(Boolean)
    .filter(name => name.toLowerCase() !== 'unidentified'))];
  const comment = clean(species.Comments);
  const feedingSentence = comment.match(/(?:Feeds? on|Omnivorous\.)[^.]*\.?/i)?.[0] || '';

  return {
    trophicLevel: trophicLabel(estimate?.Troph ?? ecology?.DietTroph ?? ecology?.FoodTroph),
    fooditems: foodNames.length
      ? foodNames.join(', ')
      : feedingSentence || 'Specific food items are not listed in the local FishBase extract; specialist diet review is required.',
    feedingPlaybook: '',
  };
}

function buildRecord(species, estimate, ecology, repro, spawn, foodRows) {
  const scientificName = `${species.Genus} ${species.Species}`;
  const note = personalityNotes[scientificName];
  if (!note) throw new Error(`Missing reviewed personality note for ${scientificName}`);

  const comment = clean(species.Comments);
  const commonName = clean(species.FBname) || `Catfish (${scientificName})`;

  return {
    specCode: species.SpecCode,
    scientificName,
    genus: species.Genus,
    species: species.Species,
    commonName,
    family: FAMILY,
    type: 'fish',
    maxLengthCm: roundedLength(species.Length || estimate?.MaxLengthTL),
    masterPhotoUrl: '',
    tankMetrics: { difficulty: 'Unknown' },
    enhanced: false,
    sources: [{
      name: 'FishBase',
      url: `https://www.fishbase.se/summary/${species.Genus}-${species.Species}.html`,
      type: 'Scientific data',
    }],
    ecology: {
      comments: comment || 'FishBase has limited ecology notes for this species.',
    },
    diet: buildDiet(species, estimate, ecology, foodRows),
    reproduction: buildBreeding(repro, spawn),
    personality: {
      vibeLine: { casual: note[0], pro: note[1] },
      flavorText: {
        casual: `${note[0]} Start with smooth substrate, stable water, and a species-specific plan before attempting breeding.`,
        pro: `${note[1]} FishBase is the source for the natural-history claims; verify captive methods with specialist breeder guidance before presenting them as routine care.`,
      },
    },
  };
}

async function main() {
  const catalog = JSON.parse(readFileSync(PUBLIC_PATH, 'utf8'));
  const rootCatalog = JSON.parse(readFileSync(ROOT_PATH, 'utf8'));
  const existingCodes = new Set(catalog.map(record => record.specCode));
  const existingNames = new Set(catalog.map(record => record.scientificName.toLowerCase()));

  const [speciesRows, estimateRows, ecologyRows, reproRows, spawningRows, foodRows] = await Promise.all([
    loadParquet('species', ['SpecCode', 'Genus', 'Species', 'FBname', 'Length', 'Comments']),
    loadParquet('estimate', ['SpecCode', 'MaxLengthTL', 'Troph']),
    loadParquet('ecology', ['SpecCode', 'DietTroph', 'FoodTroph']),
    loadParquet('reproduc', ['SpecCode', 'ReproMode', 'Fertilization', 'RepGuild1', 'RepGuild2', 'ParentalCare', 'RepAquarium']),
    loadParquet('spawning', ['SpecCode', 'Spawningarea', 'TempLow', 'TempHigh', 'FecundityMin', 'FecundityMax']),
    loadParquet('fooditems', ['SpecCode', 'FoodI', 'FoodII', 'FoodIII', 'Foodname']),
  ]);

  const requested = new Set(selectedNames.map(name => name.toLowerCase()));
  const speciesByName = new Map();
  for (const row of speciesRows) {
    const name = `${row.Genus} ${row.Species}`;
    if (requested.has(name.toLowerCase())) speciesByName.set(name.toLowerCase(), row);
  }
  const estimateByCode = firstByCode(estimateRows);
  const ecologyByCode = firstByCode(ecologyRows);
  const reproByCode = firstByCode(reproRows);
  const spawnByCode = firstByCode(spawningRows);
  const foodByCode = new Map();
  for (const row of foodRows) {
    if (!foodByCode.has(row.SpecCode)) foodByCode.set(row.SpecCode, []);
    foodByCode.get(row.SpecCode).push(row);
  }

  const additions = [];
  for (const name of selectedNames) {
    const row = speciesByName.get(name.toLowerCase());
    if (!row) throw new Error(`FishBase species row not found: ${name}`);
    if (existingCodes.has(row.SpecCode) || existingNames.has(name.toLowerCase())) {
      throw new Error(`Species already exists in catalog: ${name}`);
    }
    additions.push(buildRecord(
      row,
      estimateByCode.get(row.SpecCode),
      ecologyByCode.get(row.SpecCode),
      reproByCode.get(row.SpecCode),
      spawnByCode.get(row.SpecCode),
      foodByCode.get(row.SpecCode) || [],
    ));
  }

  const updated = [...catalog, ...additions];
  if (rootCatalog.length !== catalog.length) throw new Error('Catalog mirrors differ before addition.');
  const serialized = JSON.stringify(updated, null, 2);
  writeFileSync(PUBLIC_PATH, serialized, 'utf8');
  writeFileSync(ROOT_PATH, serialized, 'utf8');

  console.log(JSON.stringify({
    added: additions.length,
    totalRecords: updated.length,
    family: FAMILY,
    output: [PUBLIC_PATH, ROOT_PATH],
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
