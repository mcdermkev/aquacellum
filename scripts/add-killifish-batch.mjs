/**
 * add-killifish-batch.mjs
 *
 * Adds the first curated Nothobranchiidae batch to both canonical catalogs.
 * Records are generated from local FishBase parquet data and are deliberately
 * conservative: missing temperature, tank-size, diet, or breeding details are
 * left absent or explicitly identified for specialist review.
 *
 * Usage: node scripts/add-killifish-batch.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parquetRead } from 'hyparquet';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC_PATH = resolve(ROOT, 'frontend/public/fishbase_master.json');
const ROOT_PATH = resolve(ROOT, 'frontend/fishbase_master.json');
const FAMILY = 'Nothobranchiidae';

const selectedNames = [
  'Aphyosemion abacinum',
  'Aphyosemion bitaeniatum',
  'Aphyosemion cameronense',
  'Aphyosemion christyi',
  'Aphyosemion coeleste',
  'Aphyosemion gabunense',
  'Aphyosemion lambertorum',
  'Aphyosemion maculatum',
  'Fundulopanchax amieti',
  'Fundulopanchax filamentosus',
  'Fundulopanchax gularis',
  'Fundulopanchax scheeli',
  'Fundulopanchax sjostedti',
  'Nothobranchius eggersi',
  'Nothobranchius foerschi',
  'Nothobranchius korthausae',
  'Nothobranchius microlepis',
  'Nothobranchius neumanni',
  'Epiplatys barmoiensis',
  'Epiplatys bifasciatus',
];

const personalityNotes = {
  'Aphyosemion abacinum': ['A quiet forest-brook killi for the specialist who enjoys the hard-to-find branch of the hobby.', 'Aphyosemion abacinum; non-annual forest killi with very difficult aquarium maintenance reported in FishBase.'],
  'Aphyosemion bitaeniatum': ['Two stripes, soft forest water, and a little West African mystery.', 'Aphyosemion bitaeniatum; non-annual stream killi reported as easy to maintain in the local FishBase record.'],
  'Aphyosemion cameronense': ['A swamp-and-stream killi that prefers a calm, shaded stage.', 'Aphyosemion cameronense; non-annual rainforest killi with difficult aquarium maintenance reported in FishBase.'],
  'Aphyosemion christyi': ["Christy's lyretail brings a weedy-brook personality to the killifish shelf.", "Aphyosemion christyi; non-annual shallow-brook killi with difficult aquarium maintenance reported in FishBase."],
  'Aphyosemion coeleste': ['The sky-blue killi is a small specialist from swampy rainforest brooks.', 'Aphyosemion coeleste; non-annual rainforest-brook killi with difficult aquarium maintenance reported in FishBase.'],
  'Aphyosemion gabunense': ['A Gabon killi for keepers who like peaceful water and uncommon names.', 'Aphyosemion gabunense; non-annual coastal-rainforest killi reported as easy to maintain in FishBase.'],
  'Aphyosemion lambertorum': ['A little forest killi with a big specialist-collection aura.', 'Aphyosemion lambertorum; non-annual forest killi with difficult aquarium maintenance reported in FishBase.'],
  'Aphyosemion maculatum': ['A spotted Aphyosemion for the keeper who prefers discovery to familiarity.', 'Aphyosemion maculatum; non-annual inland-rainforest brook killi with very difficult aquarium maintenance reported in FishBase.'],
  'Fundulopanchax amieti': ["Amiet's lyretail is a bottom-spawning killi with a rainforest-swamp story.", "Fundulopanchax amieti; FishBase reports bottom spawning and approximately one-month incubation."],
  'Fundulopanchax filamentosus': ['The plumed lyretail turns a shaded swamp into a tiny breeding laboratory.', 'Fundulopanchax filamentosus; bottom-spawning killi with FishBase notes of approximately 1.5-month incubation.'],
  'Fundulopanchax gularis': ['A larger gularis with the patient, deliberate rhythm of a bottom-spawning killi.', 'Fundulopanchax gularis; bottom-spawning killi with FishBase notes of approximately two-month incubation.'],
  'Fundulopanchax scheeli': ['A rainforest-brook killi for a keeper building a carefully researched collection.', 'Fundulopanchax scheeli; non-annual killi reported as easy to maintain in the local FishBase record.'],
  'Fundulopanchax sjostedti': ['The blue gularis is the bold, large-bodied showpiece of this first batch.', 'Fundulopanchax sjostedti; large non-annual killi with bottom-spawning and approximately two-month incubation notes in FishBase.'],
  'Nothobranchius eggersi': ['A temporary-pool killi whose life cycle makes every generation feel like a deadline.', 'Nothobranchius eggersi; annual-style bottom spawner with FishBase notes of two-to-three-month incubation.'],
  'Nothobranchius foerschi': ['A small notho with a big seasonal story written into its eggs.', 'Nothobranchius foerschi; FishBase reports bottom spawning and two-to-four-month incubation.'],
  'Nothobranchius korthausae': ['The Korthausae notho brings temporary pools and patient egg incubation to the fish room.', 'Nothobranchius korthausae; bottom spawner from temporary pools with one-to-three-month incubation noted in FishBase.'],
  'Nothobranchius microlepis': ['A small-scaled notho for keepers who want a true specialist breeding project.', 'Nothobranchius microlepis; temporary-pool bottom spawner with approximately three-month incubation reported in FishBase.'],
  'Nothobranchius neumanni': ['A quiet notho whose incomplete incubation note is a reason to research before keeping.', 'Nothobranchius neumanni; FishBase identifies bottom spawning but reports an incomplete incubation value.'],
  'Epiplatys barmoiensis': ['A surface-oriented West African killi for shaded swamp and small-river setups.', 'Epiplatys barmoiensis; FishBase reports a non-guarding brood-hider reproductive guild and very difficult aquarium maintenance.'],
  'Epiplatys bifasciatus': ['A two-banded killi that browses the edges of swamps, brooks, and weedy rivers.', 'Epiplatys bifasciatus; non-seasonal West African killi with brood-hider reproductive guild reported in FishBase.'],
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

function difficultyFromComment(comment) {
  const lower = comment.toLowerCase();
  if (lower.includes('very difficult to maintain')) return 'Expert';
  if (lower.includes('difficult to maintain')) return 'Advanced';
  if (lower.includes('easy to maintain')) return 'Intermediate';
  return 'Unknown';
}

function buildBreeding(species, repro) {
  const comment = clean(species.Comments);
  const lower = comment.toLowerCase();
  const guild = [repro?.RepGuild1, repro?.RepGuild2].filter(Boolean).map(clean).join('; ');
  let spawningTrait = 'Breeding details are limited in the local FishBase extract; manual specialist review is required.';

  if (lower.includes('bottom spawner')) {
    const incubation = comment.match(/(?:bottom spawner,?\s*)([^.]+)/i)?.[1];
    spawningTrait = incubation
      ? `Bottom spawner; FishBase notes ${clean(incubation)}.`
      : 'Bottom spawner; species-specific incubation guidance requires specialist review.';
  } else if (lower.includes('not a seasonal killifish')) {
    spawningTrait = 'Non-seasonal killifish; FishBase does not provide a complete captive spawning protocol in this extract.';
  } else if (guild) {
    spawningTrait = `FishBase reproductive guild: ${guild}.`;
  }

  const details = [
    repro?.ReproMode ? `Reproductive mode: ${clean(repro.ReproMode)}.` : '',
    repro?.Fertilization ? `Fertilization: ${clean(repro.Fertilization)}.` : '',
    guild ? `Guild: ${guild}.` : '',
    repro?.ParentalCare ? `Parental care: ${clean(repro.ParentalCare)}.` : '',
  ].filter(Boolean).join(' ');

  return {
    spawningTrait,
    layoutRequirement: lower.includes('bottom spawner')
      ? 'FishBase identifies this as a bottom spawner; use a species-specific spawning medium only after confirming specialist guidance.'
      : 'Provide species-appropriate cover and a secure lid; exact spawning layout requires specialist review.',
    comments: [comment, details].filter(Boolean).join(' ') || 'FishBase has limited breeding notes for this species.',
  };
}

function buildDiet(species, estimate, ecology, foodRows) {
  const foodNames = [...new Set(foodRows
    .map(row => clean(row.Foodname || row.FoodIII || row.FoodII || row.FoodI))
    .filter(Boolean)
    .filter(name => name.toLowerCase() !== 'unidentified'))];
  const comment = clean(species.Comments);
  const feedingSentence = comment.match(/Feeds? on [^.]+\./i)?.[0] || '';

  return {
    trophicLevel: trophicLabel(estimate?.Troph ?? ecology?.DietTroph ?? ecology?.FoodTroph),
    fooditems: foodNames.length
      ? foodNames.join(', ')
      : feedingSentence || 'Specific food items are not listed in the local FishBase extract; specialist diet review is required.',
    feedingPlaybook: '',
  };
}

function buildRecord(species, estimate, ecology, repro, foodRows) {
  const scientificName = `${species.Genus} ${species.Species}`;
  const note = personalityNotes[scientificName];
  if (!note) throw new Error(`Missing reviewed personality note for ${scientificName}`);

  const comment = clean(species.Comments);
  const commonName = clean(species.FBname) || `Killifish (${scientificName})`;
  const maxLengthCm = Number(species.Length || estimate?.MaxLengthTL || 0) || null;

  return {
    specCode: species.SpecCode,
    scientificName,
    genus: species.Genus,
    species: species.Species,
    commonName,
    family: FAMILY,
    type: 'fish',
    maxLengthCm,
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
    reproduction: buildBreeding(species, repro),
    personality: {
      vibeLine: { casual: note[0], pro: note[1] },
      flavorText: {
        casual: `${note[0]} Start with a secure lid, stable water, and species-specific research before attempting a breeding setup.`,
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

  const [speciesRows, estimateRows, ecologyRows, reproRows, foodRows] = await Promise.all([
    loadParquet('species', ['SpecCode', 'Genus', 'Species', 'FBname', 'Length', 'Comments']),
    loadParquet('estimate', ['SpecCode', 'MaxLengthTL', 'Troph']),
    loadParquet('ecology', ['SpecCode', 'DietTroph', 'FoodTroph']),
    loadParquet('reproduc', ['SpecCode', 'ReproMode', 'Fertilization', 'RepGuild1', 'RepGuild2', 'ParentalCare']),
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
