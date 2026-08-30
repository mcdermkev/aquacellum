/**
 * add-characidae-batch.mjs
 *
 * Adds a curated Characidae batch to both canonical catalogs using local
 * FishBase parquet data. Missing care and breeding facts remain explicit rather
 * than being inferred from tetra or characin stereotypes.
 *
 * Usage: node scripts/add-characidae-batch.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parquetRead } from 'hyparquet';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC_PATH = resolve(ROOT, 'frontend/public/fishbase_master.json');
const ROOT_PATH = resolve(ROOT, 'frontend/fishbase_master.json');
const FAMILY = 'Characidae';
const FAMILY_CODE = 812;

const selectedNames = [
  'Holopristis pulchra',
  'Petitella georgiae',
  'Holopristis ocellifera',
  'Bario oligolepis',
  'Brachychalcinus orbicularis',
  'Ctenobrycon spilurus',
  'Hemigrammus unilineatus',
  'Hyphessobrycon flammeus',
  'Hyphessobrycon griemi',
  'Hyphessobrycon heterorhabdus',
  'Hyphessobrycon scholzei',
  'Pristella maxillaris',
  'Gymnocharacinus bergii',
  'Hemigrammus hyanuary',
  'Megalamphodus bentosi',
  'Megalamphodus rosaceus',
  'Thayeria obliqua',
  'Astyanax mexicanus',
  'Astyanax bimaculatus',
  'Hemigrammus collettii',
];

const expectedSpecCodes = {
  'Holopristis pulchra': 10649,
  'Petitella georgiae': 10695,
  'Holopristis ocellifera': 10645,
  'Bario oligolepis': 12391,
  'Brachychalcinus orbicularis': 10693,
  'Ctenobrycon spilurus': 10629,
  'Hemigrammus unilineatus': 12371,
  'Hyphessobrycon flammeus': 10652,
  'Hyphessobrycon griemi': 10653,
  'Hyphessobrycon heterorhabdus': 10655,
  'Hyphessobrycon scholzei': 10657,
  'Pristella maxillaris': 10697,
  'Gymnocharacinus bergii': 6183,
  'Hemigrammus hyanuary': 12367,
  'Megalamphodus bentosi': 12378,
  'Megalamphodus rosaceus': 12383,
  'Thayeria obliqua': 12401,
  'Astyanax mexicanus': 2740,
  'Astyanax bimaculatus': 4475,
  'Hemigrammus collettii': 26473,
};

const personalityNotes = {
  'Holopristis pulchra': ['The garnet tetra is a tiny red schooling fish with a documented plant-spawning story.', 'Holopristis pulchra; highly commercial Characidae with plant-associated spawning, 20–24 hour hatching, and medium aquarium-breeding evidence.'],
  'Petitella georgiae': ['The false rummynose brings a tight-schooling rhythm without pretending to be the true rummy-nose.', 'Petitella georgiae; gregarious false rummynose tetra with external egg scattering and source-backed aquarium reproduction.'],
  'Holopristis ocellifera': ['The head-and-taillight tetra turns a familiar pattern into a small breeding project.', 'Holopristis ocellifera; prolific commercial tetra with reported aquarium breeding and 48–60 hour hatching.'],
  'Bario oligolepis': ['The glass tetra is the large, counter-current characin in this otherwise tetra-shaped set.', 'Bario oligolepis; commercial, gregarious creek fish with source-backed external spawning and easy aquarium reproduction notes.'],
  'Brachychalcinus orbicularis': ['The discus tetra has a round profile and a larger-than-nano presence.', 'Brachychalcinus orbicularis; commercial 9 cm characin with omnivorous evidence and external egg scattering.'],
  'Ctenobrycon spilurus': ['The silver tetra is a substantial open-water fish with a surprisingly large reported spawn.', 'Ctenobrycon spilurus; commercial characin with approximately 2,000 eggs per female and nonguarding reproduction reported in FishBase.'],
  'Hemigrammus unilineatus': ['The featherfin tetra is a peaceful, gregarious fish for the planted midwater.', 'Hemigrammus unilineatus; commercial schooling tetra with slow-water habitat, easy-rearing notes, and external egg scattering.'],
  'Hyphessobrycon flammeus': ['The flame tetra is a small ember of color for a shaded, planted school.', 'Hyphessobrycon flammeus; commercial blackwater-associated tetra with reported aquarium egg counts and two-to-three-day hatching.'],
  'Hyphessobrycon griemi': ['The goldspotted tetra is a tiny schooling characin with strong aquarium-breeding evidence.', 'Hyphessobrycon griemi; commercial tetra with external egg scattering and a high FishBase aquarium-breeding rating.'],
  'Hyphessobrycon heterorhabdus': ['The flag tetra carries a fine lateral mark through a compact schooling body.', 'Hyphessobrycon heterorhabdus; commercial tetra with source-backed external nonguarding egg scattering.'],
  'Hyphessobrycon scholzei': ['The blackline tetra is a subtle schooler for keepers who enjoy pattern over flash.', 'Hyphessobrycon scholzei; commercial tetra with high FishBase aquarium-breeding evidence and external egg scattering.'],
  'Pristella maxillaris': ['The X-ray tetra is transparent-looking, sturdy, and happiest as part of a real group.', 'Pristella maxillaris; robust commercial schooling tetra with easy reproduction notes and a reported 300–400 eggs per spawn.'],
  'Gymnocharacinus bergii': ['The naked characin is the unusual temperate specialist of this batch.', 'Gymnocharacinus bergii; rare scale-reducing characin with periphytic-algae evidence and a riverine spawning record.'],
  'Hemigrammus hyanuary': ['The January tetra is a quieter catalog find for a keeper building beyond the usual shortlist.', 'Hemigrammus hyanuary; commercial tetra with source-backed external nonguarding reproduction and limited additional local notes.'],
  'Megalamphodus bentosi': ['The ornate tetra is a softly patterned schooler whose accepted genus deserves careful labeling.', 'Megalamphodus bentosi; FishBase-accepted commercial characin with group-keeping and external egg-scattering records.'],
  'Megalamphodus rosaceus': ['The rosy tetra brings a restrained pink tone to the specialist characin list.', 'Megalamphodus rosaceus; commercial oviparous characin with external nonguarding egg-scattering data.'],
  'Thayeria obliqua': ['The penguinfish is the longer-bodied, diagonally poised schooler of this batch.', 'Thayeria obliqua; commercial 7.6 cm characin with external nonguarding egg-scattering evidence.'],
  'Astyanax mexicanus': ['The Mexican tetra has a larger body and a remarkable surface-and-cave natural-history story.', 'Astyanax mexicanus; commercial characin with external brood-hider reproduction and a complex surface/cave lineage that needs careful catalog framing.'],
  'Astyanax bimaculatus': ['The twospot astyanax is a substantial characin, not a nano tetra in disguise.', 'Astyanax bimaculatus; commercial 17.5 cm characin with seasonal reproductive evidence and broad omnivorous feeding records.'],
  'Hemigrammus collettii': ['A peaceful schooling characin whose common name is intentionally left to FishBase rather than invented.', 'Hemigrammus collettii; commercial Characidae with FishBase common name not supplied, food-item records, and external nonguarding egg scattering.'],
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
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number < 2.8) return 'Herbivore / Detritivore';
  if (number < 3.8) return 'Omnivore';
  return 'Carnivore / Piscivore';
}

function difficultyFromComment(comment) {
  const lower = comment.toLowerCase();
  if (lower.includes('very difficult to maintain')) return 'Expert';
  if (lower.includes('difficult to maintain')) return 'Advanced';
  if (lower.includes('easy to maintain')) return 'Intermediate';
  return 'Unknown';
}

function roundedLength(species, estimate) {
  const raw = Number(species.Length ?? estimate?.MaxLengthTL);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : null;
}

function buildBreeding(species, repro, spawn) {
  const comment = clean(species.Comments);
  const guild = [repro?.RepGuild1, repro?.RepGuild2]
    .filter(Boolean)
    .map(clean)
    .join('; ');
  const sourceText = [
    comment,
    repro?.ReproMode,
    repro?.Fertilization,
    repro?.ParentalCare,
    guild,
  ].filter(Boolean).join(' ');
  const lowerSource = sourceText.toLowerCase();

  let spawningTrait = 'Breeding details are not reported in the local FishBase extract; manual specialist review is required.';
  let layoutRequirement = 'Species-specific spawning layout is not reported in the local extract; specialist review is required before presenting a breeding setup.';

  if (/brood\s*hider|brood-hider/.test(lowerSource)) {
    spawningTrait = 'FishBase reproductive guild: external nonguarder brood hider.';
    layoutRequirement = 'FishBase identifies a brood-hider guild; confirm the species-specific egg-deposition setup with specialist breeder guidance.';
  } else if (/open[- ]water|substratum|egg scatter|egg-scatter/.test(lowerSource)) {
    spawningTrait = 'FishBase reproductive guild: external nonguarder open-water/substratum egg scatterer.';
    layoutRequirement = 'FishBase identifies open-water or substratum egg scattering; confirm the species-specific spawning medium and egg-protection method with specialist breeder guidance.';
  } else if (guild) {
    spawningTrait = `FishBase reproductive guild: ${guild}.`;
  } else if (repro?.ReproMode || repro?.Fertilization) {
    spawningTrait = `FishBase records ${clean(repro.ReproMode || 'sexual reproduction')}${repro.Fertilization ? ` with ${clean(repro.Fertilization)} fertilization` : ''}.`;
  }

  const details = [
    repro?.ReproMode ? `Reproductive mode: ${clean(repro.ReproMode)}.` : '',
    repro?.Fertilization ? `Fertilization: ${clean(repro.Fertilization)}.` : '',
    guild ? `Guild: ${guild}.` : '',
    repro?.ParentalCare ? `Parental care: ${clean(repro.ParentalCare)}.` : '',
    repro?.RepAquarium ? `FishBase aquarium-breeding rating: ${clean(repro.RepAquarium)}.` : '',
    spawn?.Spawningarea ? `Spawning area: ${clean(spawn.Spawningarea)}.` : '',
    spawn?.TempLow != null || spawn?.TempHigh != null
      ? `Recorded spawning temperature: ${spawn.TempLow ?? '—'}–${spawn.TempHigh ?? '—'}°C.`
      : '',
    spawn?.FecundityMin != null || spawn?.FecundityMax != null
      ? `Recorded fecundity: ${spawn.FecundityMin ?? '—'}–${spawn.FecundityMax ?? '—'}.`
      : '',
  ].filter(Boolean).join(' ');

  return {
    spawningTrait,
    layoutRequirement,
    comments: [comment, details].filter(Boolean).join(' ') || 'FishBase has limited breeding notes for this species.',
  };
}

function buildDiet(species, estimate, ecology, foodRows) {
  const foodNames = [...new Set(foodRows
    .map(row => clean(row.Foodname || row.FoodIII || row.FoodII || row.FoodI))
    .filter(Boolean)
    .filter(name => name.toLowerCase() !== 'unidentified'))];
  const comment = clean(species.Comments);
  const feedingSentence = comment.match(/(?:Feeds? on|feed(?:s|ing)? mainly on|omnivorous)[^.]*\.?/i)?.[0] || '';

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
  const commonName = clean(species.FBname) || `Common name not supplied by FishBase (${scientificName})`;

  return {
    specCode: Number(species.SpecCode),
    scientificName,
    genus: species.Genus,
    species: species.Species,
    commonName,
    family: FAMILY,
    type: 'fish',
    maxLengthCm: roundedLength(species, estimate),
    masterPhotoUrl: '',
    tankMetrics: {
      difficulty: difficultyFromComment(comment),
    },
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
    reproduction: buildBreeding(species, repro, spawn),
    personality: {
      vibeLine: { casual: note[0], pro: note[1] },
      flavorText: {
        casual: `${note[0]} Start with a proper group, stable water, and species-specific research before attempting a breeding setup.`,
        pro: `${note[1]} FishBase is the source for the natural-history claims; verify captive methods with specialist breeder guidance before presenting them as routine care.`,
      },
    },
  };
}

async function main() {
  if (selectedNames.length !== 20) throw new Error(`Expected 20 selected species, got ${selectedNames.length}`);
  if (new Set(selectedNames).size !== selectedNames.length) throw new Error('Selected species contain duplicates.');
  if (Object.keys(expectedSpecCodes).length !== selectedNames.length) throw new Error('Expected SpecCode map is incomplete.');

  const catalog = JSON.parse(readFileSync(PUBLIC_PATH, 'utf8'));
  const rootCatalog = JSON.parse(readFileSync(ROOT_PATH, 'utf8'));
  if (JSON.stringify(rootCatalog) !== JSON.stringify(catalog)) throw new Error('Catalog mirrors differ before addition.');

  const existingCodes = new Set(catalog.map(record => record.specCode));
  const existingNames = new Set(catalog.map(record => String(record.scientificName).toLowerCase()));

  const [speciesRows, estimateRows, ecologyRows, reproRows, spawningRows, foodRows] = await Promise.all([
    loadParquet('species', ['SpecCode', 'Genus', 'Species', 'FamCode', 'Fresh', 'Brack', 'Saltwater', 'FBname', 'Length', 'Comments']),
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
  for (const requestedName of selectedNames) {
    const row = speciesByName.get(requestedName.toLowerCase());
    if (!row) throw new Error(`FishBase species row not found: ${requestedName}`);

    const scientificName = `${row.Genus} ${row.Species}`;
    const expectedCode = expectedSpecCodes[requestedName];
    if (scientificName.toLowerCase() !== requestedName.toLowerCase()) {
      throw new Error(`FishBase name mismatch: requested ${requestedName}, found ${scientificName}`);
    }
    if (Number(row.SpecCode) !== expectedCode) {
      throw new Error(`FishBase SpecCode mismatch for ${requestedName}: expected ${expectedCode}, found ${row.SpecCode}`);
    }
    if (Number(row.FamCode) !== FAMILY_CODE) {
      throw new Error(`FishBase family mismatch for ${requestedName}: expected FamCode ${FAMILY_CODE}, found ${row.FamCode}`);
    }
    if (Number(row.Fresh) !== 1 || Number(row.Brack) !== 0 || Number(row.Saltwater) !== 0) {
      throw new Error(`Freshwater flag check failed for ${requestedName}`);
    }
    if (existingCodes.has(Number(row.SpecCode)) || existingNames.has(requestedName.toLowerCase())) {
      throw new Error(`Species already exists in catalog: ${requestedName}`);
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

  if (additions.length !== 20) throw new Error(`Expected 20 additions, built ${additions.length}`);
  const updated = [...catalog, ...additions];
  if (updated.length !== catalog.length + 20) throw new Error('Unexpected catalog size after addition.');

  const serialized = JSON.stringify(updated, null, 2);
  writeFileSync(PUBLIC_PATH, serialized, 'utf8');
  writeFileSync(ROOT_PATH, serialized, 'utf8');

  console.log(JSON.stringify({
    added: additions.length,
    totalRecords: updated.length,
    family: FAMILY,
    names: additions.map(record => record.scientificName),
    output: [PUBLIC_PATH, ROOT_PATH],
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
