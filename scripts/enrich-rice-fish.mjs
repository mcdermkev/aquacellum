/**
 * enrich-rice-fish.mjs
 *
 * Fill-only enrichment pass for the Adrianichthyidae records in the canonical
 * catalogs. It uses the local FishBase parquet tables for breeding/ecology/diet
 * facts and adds the catalog's personality shape without replacing existing
 * fields. Run after reviewing the generated diff.
 *
 * Usage: node scripts/enrich-rice-fish.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parquetRead } from 'hyparquet';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC_PATH = resolve(ROOT, 'frontend/public/fishbase_master.json');
const ROOT_PATH = resolve(ROOT, 'frontend/fishbase_master.json');
const FAMILY = 'Adrianichthyidae';

const taglineNotes = {
  'Oryzias setnai': ['The coastal ricefish that is comfortable where fresh and brackish water meet.', 'Estuarine ricefish with documented year-round breeding and broad salinity tolerance.'],
  'Oryzias latipes': ['The classic medaka: small, hardy, and endlessly interesting to watch.', 'Japanese ricefish and established laboratory model; a surface-oriented, non-annual breeder.'],
  'Oryzias luzonensis': ['A quiet island medaka for keepers who enjoy the less-traveled branch of the hobby.', 'Luzon ricefish; a small Oryzias with limited aquarium and breeding data in the local source.'],
  'Adrianichthys kruyti': ['A rare, long-bodied buntingi for a specialist collection rather than a casual community tank.', 'Adrianichthys kruyti; a large-bodied Adrianichthyid requiring species-specific research before acquisition.'],
  'Adrianichthys oophorus': ['The egg-carrying buntingi makes parental investment impossible to miss.', 'Adrianichthys oophorus; eggs are carried between the pelvic fins on attaching filaments.'],
  'Adrianichthys poptae': ['A mysterious buntingi whose eggs stay with the parent instead of disappearing into the plants.', 'Adrianichthys poptae; FishBase records maternal egg attachment between the pelvic fins.'],
  'Oryzias sarasinorum': ['A rare medaka with a remarkable habit: the female carries the egg cluster.', 'Oryzias sarasinorum; maternal pelvic brooder with eggs attached between the pelvic fins.'],
  'Oryzias marmoratus': ['Lake-born medaka with a marbled name and a specialist-only reputation.', 'Oryzias marmoratus; Sulawesi lake endemic with maternal egg-carrying biology and difficult aquarium history.'],
  'Oryzias matanensis': ['A lake medaka that rewards patient observation more than impulse buying.', 'Oryzias matanensis; Sulawesi lake species with maternal care recorded and limited aquarium suitability.'],
  'Oryzias nigrimas': ['The black buntingi is a shadowy little specialist from the medaka family.', 'Oryzias nigrimas; a non-annual Adrianichthyid breeder with limited captive-care documentation.'],
  'Oryzias orthognathus': ['Sharp-jawed and unusual, this buntingi is one for the species-list devotee.', 'Oryzias orthognathus; a specialist Adrianichthyid with limited aquarium breeding information.'],
  'Oryzias profundicola': ['A yellow-finned medaka built for quiet lake shores and close looking.', 'Oryzias profundicola; a shallow-littoral Sulawesi species with maternal care recorded in FishBase.'],
  'Oryzias celebensis': ['The Celebes medaka brings island-lake character in a very small package.', 'Oryzias celebensis; a research-used, non-annual breeder with difficult aquarium maintenance noted.'],
  'Oryzias javanicus': ['The Javanese ricefish is a surface hunter that turns plant cover into a living stage.', 'Oryzias javanicus; surface-associated ricefish feeding on small crustaceans, insects, and protozoans.'],
  'Oryzias mekongensis': ['A tiny canal-and-pond ricefish that disappears into fine aquatic vegetation.', 'Oryzias mekongensis; plankton-feeding non-annual breeder from shallow standing waters.'],
  'Oryzias minutillus': ['The dwarf medaka proves that a small fish can still have a full natural history.', 'Oryzias minutillus; a very small Oryzias from clear-water swamps with non-annual breeding recorded.'],
  'Oryzias curvinotus': ['A compact medaka for the keeper drawn to uncommon names and smaller fish.', 'Oryzias curvinotus; a small Oryzias with limited breeding documentation in the local FishBase tables.'],
  'Oryzias timorensis': ['Timor ricefish is a quiet specialist waiting for better-known company to catch up.', 'Oryzias timorensis; a small Adrianichthyid with limited captive-breeding documentation.'],
  'Oryzias dancena': ['The Indian blue ricefish adds a flash of color to the ricefish family tree.', 'Oryzias dancena; coastal freshwater-to-brackish ricefish with broad habitat tolerance.'],
  'Oryzias carnaticus': ['A spotted ricefish with a taste for the boundary between fresh and salt water.', 'Oryzias carnaticus; estuarine-associated Oryzias that can also occupy freshwater.'],
  'Oryzias uwai': ['A tiny ricefish whose rarity is part of the appeal.', 'Oryzias uwai; a small Adrianichthyid requiring specialist husbandry research.'],
  'Oryzias pectoralis': ['A rice-paddy fish with a name that sounds tougher than its tiny size.', 'Oryzias pectoralis; small ricefish recorded from paddies, swamps, and sheltered slow rivers.'],
  'Oryzias haugiangensis': ['A little ricefish shaped by tides and changing water.', 'Oryzias haugiangensis; tidal-influenced Oryzias with limited captive data.'],
  'Oryzias hubbsi': ['A small hill-country ricefish for collectors who like the obscure corners of FishBase.', 'Oryzias hubbsi; upland-associated Adrianichthyid with limited aquarium documentation.'],
  'Oryzias sinensis': ['The Chinese ricefish is a tiny survivor with a surprisingly wide temperature story.', 'Oryzias sinensis; seasonal breeder from East Asian wetlands, rice fields, and shallow lake margins.'],
  'Adrianichthys roseni': ['A rare buntingi with open-water mystery written into its natural history.', 'Adrianichthys roseni; pelagic tendency is noted by FishBase, while captive care remains specialist territory.'],
  'Oryzias nebulosus': ['A cloudy-named medaka from clear lake shores and quiet tributaries.', 'Oryzias nebulosus; lake-associated Oryzias with limited captive breeding data.'],
  'Oryzias melastigma': ['The brackish-edge ricefish that keeps one fin in the sea and one in fresh water.', 'Oryzias melastigma; estuarine and mangrove-associated species that readily adapts to freshwater.'],
  'Oryzias bonneorum': ['A little-known medaka with a big biological twist: the female carries the egg cluster.', 'Oryzias bonneorum; pelvic brooder with maternal egg carrying recorded in FishBase.'],
  'Oryzias woworae': ['A tiny island ricefish that deserves a closer look than its size suggests.', 'Oryzias woworae; small Adrianichthyid with limited source-backed aquarium data.'],
  'Oryzias songkhramensis': ['A paddy-field ricefish from clear ditches and warm, planted shallows.', 'Oryzias songkhramensis; Mekong-basin ditch and paddy-field species with documented water observations.'],
  'Oryzias hadiatyae': ['A blackwater lake medaka with a quiet, forested personality.', 'Oryzias hadiatyae; blackwater-lake Oryzias whose habitat is vulnerable to predation pressure.'],
  'Oryzias sakaizumii': ['The northern medaka brings floodplain wetlands and paddy canals into the aquarium conversation.', 'Oryzias sakaizumii; wetland-adapted ricefish from ponds, marshes, and irrigation canals.'],
  'Oryzias eversi': ['A karst-pond medaka with crystal water and a very unusual maternal routine.', 'Oryzias eversi; pelvic brooder from a Sulawesi karst pond, with maternal egg carrying recorded.'],
  'Oryzias asinua': ['A small floodplain ricefish that handles both slow pools and moving water.', 'Oryzias asinua; freshwater floodplain species with field records near 26°C.'],
  'Oryzias wolasi': ['A stream-loving ricefish that can handle both cool falls and warmer springs.', 'Oryzias wolasi; stream-associated Oryzias recorded across approximately 24–26°C waters.'],
  'Oryzias soerotoi': ['A dark-lake ricefish surrounded by forest, plants, and quiet water.', 'Oryzias soerotoi; Lake Tiu species associated with shallow vegetated habitats.'],
  'Oryzias kalimpaaensis': ['The Lake Kalimpa’a ricefish comes with a lake, a story, and a remarkable breeding strategy.', 'Oryzias kalimpaaensis; pelvic brooder from a cool, acidic lake environment.'],
  'Oryzias polylepis': ['A newly catalogued ricefish for keepers who prefer discovery over familiarity.', 'Oryzias polylepis; Adrianichthyid reference species with limited local husbandry data.'],
  'Oryzias chenglongensis': ['A tidal-edge ricefish that can still settle into fresh water.', 'Oryzias chenglongensis; wetland and estuarine Oryzias documented to survive freshwater conditions.'],
  'Oryzias dopingdopingensis': ['A river ricefish with a name as memorable as its sandy, moderate-flow habitat.', 'Oryzias dopingdopingensis; middle-river species associated with moderate current and sand-gravel substrate.'],
  'Oryzias landangiensis': ['A newly catalogued ricefish for the patient specialist.', 'Oryzias landangiensis; FishBase reference record with limited additional captive data.'],
  'Oryzias loxolepis': ['The Towuti ricefish schools along shallow boulder-strewn shores.', 'Oryzias loxolepis; Lake Towuti littoral species observed schooling with other endemic Oryzias.'],
  'Oryzias moramoensis': ['A little-known ricefish that keeps the discovery list growing.', 'Oryzias moramoensis; Adrianichthyid reference record awaiting deeper captive-breeding documentation.'],
};

function getAB(filePath) {
  const buf = readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function loadParquet(name, columns) {
  const path = resolve(ROOT, `fishbase_${name}.parquet`);
  let rows = [];
  await parquetRead({ file: getAB(path), columns, rowFormat: 'object', onComplete: data => { rows = data; } });
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
  for (const row of rows) if (!map.has(row.SpecCode)) map.set(row.SpecCode, row);
  return map;
}

function trophicLabel(value) {
  if (value == null) return null;
  if (value < 2.8) return 'Herbivore / Detritivore';
  if (value < 3.8) return 'Omnivore';
  return 'Carnivore / Piscivore';
}

function buildBreeding(sp, repro, spawn) {
  const sourceComment = clean(sp.Comments);
  const lower = sourceComment.toLowerCase();
  const parental = clean(repro?.ParentalCare).toLowerCase();
  let spawningTrait = '';

  if (lower.includes('pelvic-brooder') || lower.includes('eggs are carried between the pelvic fins') || parental === 'maternal') {
    spawningTrait = 'Pelvic brooder; the female carries an egg cluster until hatching.';
  } else if (lower.includes('non-annual breeder')) {
    spawningTrait = 'Non-annual breeder; detailed captive spawning guidance remains limited in FishBase.';
  } else if (repro?.Spawning) {
    spawningTrait = `FishBase spawning pattern: ${clean(repro.Spawning)}.`;
  } else if (repro?.ReproMode) {
    spawningTrait = `Oviparous; FishBase records ${clean(repro.ReproMode)} reproduction, with species-specific spawning details limited.`;
  } else {
    spawningTrait = 'Breeding details are not reported in the local FishBase extract; manual specialist review is required.';
  }

  const comments = [
    sourceComment,
    spawn?.Spawningarea ? `FishBase spawning area: ${clean(spawn.Spawningarea)}.` : '',
    spawn?.TempLow != null || spawn?.TempHigh != null
      ? `Recorded spawning temperature: ${spawn.TempLow ?? '—'}–${spawn.TempHigh ?? '—'}°C.`
      : '',
  ].filter(Boolean).join(' ');

  return {
    spawningTrait,
    layoutRequirement: '',
    comments: comments || 'FishBase has limited breeding notes for this species.',
  };
}

async function main() {
  const catalog = JSON.parse(readFileSync(PUBLIC_PATH, 'utf8'));
  const rootCatalog = JSON.parse(readFileSync(ROOT_PATH, 'utf8'));
  const targetCodes = new Set(catalog.filter(sp => sp.family === FAMILY).map(sp => sp.specCode));

  const [speciesRows, reproRows, spawnRows, ecologyRows, foodRows] = await Promise.all([
    loadParquet('species', ['SpecCode', 'Comments']),
    loadParquet('reproduc', ['SpecCode', 'ReproMode', 'ParentalCare', 'Spawning', 'RepAquarium']),
    loadParquet('spawning', ['SpecCode', 'Spawningarea', 'TempLow', 'TempHigh']),
    loadParquet('ecology', ['SpecCode', 'FeedingType', 'DietTroph', 'FoodTroph']),
    loadParquet('fooditems', ['SpecCode', 'Foodname', 'FoodI', 'FoodII']),
  ]);

  const speciesByCode = firstByCode(speciesRows);
  const reproByCode = firstByCode(reproRows);
  const spawnByCode = firstByCode(spawnRows);
  const ecologyByCode = firstByCode(ecologyRows);
  const foodByCode = new Map();
  for (const row of foodRows) {
    if (!targetCodes.has(row.SpecCode)) continue;
    if (!foodByCode.has(row.SpecCode)) foodByCode.set(row.SpecCode, []);
    foodByCode.get(row.SpecCode).push(row);
  }

  let updatedPersonality = 0;
  let updatedBreeding = 0;
  let updatedEcology = 0;
  let updatedDiet = 0;

  for (const sp of catalog.filter(item => item.family === FAMILY)) {
    const note = taglineNotes[sp.scientificName] || [
      `${sp.commonName || sp.scientificName} is a ricefish for the specialist keeper.`,
      `${sp.scientificName}. Adrianichthyid reference species; review source-backed care before keeping.`,
    ];
    if (!sp.personality) {
      sp.personality = {
        vibeLine: { casual: note[0], pro: note[1] },
        flavorText: {
          casual: `${note[0]} Start with stable water, gentle observation, and a careful species-specific plan.`,
          pro: `${note[1]} The local FishBase record should remain the primary reference while aquarium and breeding evidence is reviewed.`,
        },
      };
      updatedPersonality++;
    }

    const sourceSpecies = speciesByCode.get(sp.specCode) || {};
    const repro = reproByCode.get(sp.specCode);
    const spawn = spawnByCode.get(sp.specCode);
    const ecology = ecologyByCode.get(sp.specCode);
    const food = foodByCode.get(sp.specCode) || [];

    const breeding = buildBreeding(sourceSpecies, repro, spawn);
    if (!sp.reproduction) {
      sp.reproduction = breeding;
      updatedBreeding++;
    } else {
      if (!sp.reproduction.spawningTrait) sp.reproduction.spawningTrait = breeding.spawningTrait;
      if (!sp.reproduction.layoutRequirement) sp.reproduction.layoutRequirement = breeding.layoutRequirement;
      if (!sp.reproduction.comments) sp.reproduction.comments = breeding.comments;
    }

    if (!sp.ecology && sourceSpecies.Comments) {
      sp.ecology = { comments: clean(sourceSpecies.Comments) };
      updatedEcology++;
    }

    if (!sp.diet && (ecology || food.length > 0)) {
      const names = [...new Set(food.map(row => clean(row.Foodname || row.FoodII || row.FoodI)).filter(Boolean))];
      const trophic = ecology?.DietTroph ?? ecology?.FoodTroph;
      sp.diet = {
        trophicLevel: trophicLabel(trophic),
        fooditems: names.length ? names.join(', ') : '',
        feedingPlaybook: '',
      };
      updatedDiet++;
    }
  }

  if (catalog.length !== rootCatalog.length) throw new Error('Catalog mirrors have different lengths before enrichment.');
  const serialized = JSON.stringify(catalog, null, 2);
  writeFileSync(PUBLIC_PATH, serialized, 'utf8');
  writeFileSync(ROOT_PATH, serialized, 'utf8');

  console.log(JSON.stringify({
    targetRecords: catalog.filter(sp => sp.family === FAMILY).length,
    updatedPersonality,
    updatedBreeding,
    updatedEcology,
    updatedDiet,
    output: [PUBLIC_PATH, ROOT_PATH],
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
