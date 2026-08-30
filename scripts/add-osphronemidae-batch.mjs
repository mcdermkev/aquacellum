/**
 * add-osphronemidae-batch.mjs
 *
 * Adds a curated Osphronemidae batch to both canonical catalogs using local
 * FishBase parquet data. Missing care and breeding facts remain explicit rather
 * than being inferred from family-level assumptions.
 *
 * Usage: node scripts/add-osphronemidae-batch.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parquetRead } from 'hyparquet';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC_PATH = resolve(ROOT, 'frontend/public/fishbase_master.json');
const ROOT_PATH = resolve(ROOT, 'frontend/fishbase_master.json');
const FAMILY = 'Osphronemidae';

const selectedNames = [
  'Betta akarensis',
  'Betta bellica',
  'Trichogaster labiosa',
  'Trichopodus trichopterus',
  'Betta anabatoides',
  'Betta coccina',
  'Betta edithae',
  'Betta foerschi',
  'Parosphromenus deissneri',
  'Parosphromenus filamentosus',
  'Trichopodus microlepis',
  'Betta rubra',
  'Betta fusca',
  'Betta taeniata',
  'Betta unimaculata',
  'Parosphromenus sumatranus',
  'Parosphromenus nagyi',
  'Trichopodus pectoralis',
  'Macropodus ocellatus',
  'Betta raja',
];

const expectedSpecCodes = {
  'Betta akarensis': 12033,
  'Betta bellica': 12035,
  'Trichogaster labiosa': 4772,
  'Trichopodus trichopterus': 4675,
  'Betta anabatoides': 12034,
  'Betta coccina': 25132,
  'Betta edithae': 15896,
  'Betta foerschi': 15897,
  'Parosphromenus deissneri': 12078,
  'Parosphromenus filamentosus': 12079,
  'Trichopodus microlepis': 4729,
  'Betta rubra': 12044,
  'Betta fusca': 12037,
  'Betta taeniata': 12048,
  'Betta unimaculata': 5440,
  'Parosphromenus sumatranus': 62587,
  'Parosphromenus nagyi': 15895,
  'Trichopodus pectoralis': 499,
  'Macropodus ocellatus': 4795,
  'Betta raja': 63050,
};

const personalityNotes = {
  'Betta akarensis': ['A forest-stream mouthbrooder with a quiet, watchful presence.', 'Betta akarensis; source-backed paternal mouthbrooder from flowing Bornean forest waters.'],
  'Betta bellica': ['The slender giant betta is a surface-cover specialist with bubble-nesting roots.', 'Betta bellica; large bubble-nesting Betta with specialist habitat and breeding needs.'],
  'Trichogaster labiosa': ['A banded gourami with a patient surface-level breeding story.', 'Trichogaster labiosa; bubble nester with FishBase aquarium reproduction and a reported 500–600 egg range.'],
  'Trichopodus trichopterus': ['The three-spot gourami brings familiar labyrinth-fish character in several wild forms.', 'Trichopodus trichopterus; bubble-nesting gourami with source-backed surface breeding behavior.'],
  'Betta anabatoides': ['A large-bodied mouthbrooder for keepers drawn to understated wild bettas.', 'Betta anabatoides; paternal mouthbrooder with source-backed reproductive records.'],
  'Betta coccina': ['The scarlet badis-like betta is tiny, vivid, and built for a carefully structured setup.', 'Betta coccina; small bubble-nesting Betta with specialist soft-water requirements to verify.'],
  'Betta edithae': ['A quiet mouthbrooder whose natural-history details reward close observation.', 'Betta edithae; source-backed mouthbrooding Betta with species-specific captive methods requiring review.'],
  'Betta foerschi': ['A dark, iridescent wild betta with a bubble nest beneath the surface cover.', 'Betta foerschi; bubble-nesting Betta with conservative care and breeding guidance required.'],
  'Parosphromenus deissneri': ['A licorice gourami for the aquarist who enjoys blackwater precision.', 'Parosphromenus deissneri; cave-associated and guarding breeder from specialist blackwater habitat.'],
  'Parosphromenus filamentosus': ['A threadfin licorice gourami that turns a shaded nano tank into a behavior study.', 'Parosphromenus filamentosus; bubble-nesting specialist with source-backed reproductive data.'],
  'Trichopodus microlepis': ['The moonlight gourami is a calm, pale presence with a substantial bubble nest.', 'Trichopodus microlepis; bubble nester with FishBase aquarium reproduction and a reported 500–1,000 egg range.'],
  'Betta rubra': ['A red wild betta whose small scale makes every detail easy to notice.', 'Betta rubra; bubble-nesting Betta with species-specific captive breeding guidance requiring review.'],
  'Betta fusca': ['A muted forest betta with a paternal mouthbrooding strategy.', 'Betta fusca; source-backed mouthbrooder with specialist habitat and water requirements.'],
  'Betta taeniata': ['A striped mouthbrooder that favors the subtle side of the Betta palette.', 'Betta taeniata; source-backed paternal mouthbrooder requiring conservative specialist care.'],
  'Betta unimaculata': ['The slender one-spot betta is a long-bodied mouthbrooder with a distinctive silhouette.', 'Betta unimaculata; large, slender paternal mouthbrooder with specialist breeding needs.'],
  'Parosphromenus sumatranus': ['A Sumatran licorice gourami for a quiet, botanical blackwater project.', 'Parosphromenus sumatranus; specialist blackwater labyrinth fish with reproductive details requiring review.'],
  'Parosphromenus nagyi': ['A tiny licorice gourami whose cave-guarding behavior rewards a deliberate setup.', 'Parosphromenus nagyi; cave-associated guarding breeder with source-backed specialist behavior.'],
  'Trichopodus pectoralis': ['The snakeskin gourami is the broad-bodied, nest-guarding anchor of this batch.', 'Trichopodus pectoralis; male bubble-nest builder with egg collection and guarding reported in FishBase.'],
  'Macropodus ocellatus': ['The roundtail paradise fish carries cool-water labyrinth-fish character and old-world form.', 'Macropodus ocellatus; temperate paradise fish with species-specific breeding and housing details requiring review.'],
  'Betta raja': ['A royal wild betta for the aquarist who prefers research-led restraint.', 'Betta raja; specialist wild Betta with source-backed natural-history data and captive methods requiring review.'],
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
  const lowerComment = comment.toLowerCase();
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

  if (/mouth\s*brood|mouthbrood|mouth brooder/.test(lowerSource)) {
    spawningTrait = 'Mouthbrooder; FishBase source text identifies oral egg or fry incubation.';
    layoutRequirement = 'Provide secure cover and low-stress structure for the holding parent; confirm the species-specific mouthbrooding protocol with specialist breeder guidance.';
  } else if (/bubble\s*nest|bubble\s*nester|bubblenest|nest builder/.test(lowerSource)) {
    spawningTrait = 'Bubble nester; FishBase source text identifies surface bubble-nest reproduction.';
    layoutRequirement = 'Provide calm surface access and floating or overhanging cover; confirm the species-specific nest and fry protocol with specialist breeder guidance.';
  } else if (/cave|cavity/.test(lowerSource) && /guard|parental/.test(lowerSource)) {
    spawningTrait = 'Cave-associated breeder with guarding or parental care reported in the source data.';
    layoutRequirement = 'Provide a quiet cavity or sheltered structure only after confirming the species-specific spawning layout with specialist breeder guidance.';
  } else if (/guard|parental care/.test(lowerSource)) {
    spawningTrait = `Parental care or guarding is reported${guild ? `; FishBase reproductive guild: ${guild}.` : '.'}`;
    layoutRequirement = 'Provide sheltered structure and minimize disturbance around the breeding site; exact captive layout requires specialist review.';
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
  const commonName = clean(species.FBname) || `Labyrinth fish (${scientificName})`;

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
        casual: `${note[0]} Start with stable water, secure surface access, and species-specific research before attempting a breeding setup.`,
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
