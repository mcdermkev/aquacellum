/**
 * add-marine-batch.mjs — the first saltwater fish in the Aquadex
 * (docs/SALTWATER_SPEC.md).
 *
 * Builds records for popular marine aquarium fish from the local FishBase
 * parquet files and appends them to both catalog mirrors. Guards:
 *   - every name must exist in FishBase with the expected SpecCode and FamCode;
 *   - FishBase must mark it Saltwater;
 *   - its SpecCode and name must not already be in the catalog (some catalog
 *     codes were hand-assigned inside the FishBase range).
 *
 * Only two things are hand-written, both standard hobby knowledge: the trade
 * name people search for (FishBase's name is kept as fishbaseCommonName) and
 * a reef-safety note. Care ranges are left unknown rather than invented; the
 * catalog shows general marine ranges for display (speciesCatalog.js).
 *
 * Usage: node scripts/add-marine-batch.mjs [--write]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parquetRead } from 'hyparquet';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC_PATH = resolve(ROOT, 'frontend/public/fishbase_master.json');
const ROOT_PATH = resolve(ROOT, 'frontend/fishbase_master.json');
const WRITE = process.argv.includes('--write');

const FAMILY_BY_CODE = {
  258: 'Syngnathidae', 264: 'Scorpaenidae', 291: 'Pseudochromidae', 293: 'Grammatidae', 304: 'Apogonidae',
  343: 'Chaetodontidae', 350: 'Pomacentridae', 352: 'Cirrhitidae', 362: 'Labridae', 366: 'Opistognathidae',
  392: 'Blenniidae', 405: 'Gobiidae', 410: 'Microdesmidae', 412: 'Acanthuridae', 413: 'Siganidae',
  435: 'Callionymidae', 448: 'Tetraodontidae', 460: 'Pomacanthidae', 797: 'Anthiadidae',
};

// name: [expected SpecCode, FamCode, trade name, reef safety, one-line note]
const BATCH = {
  'Amphiprion ocellaris': [6509, 350, 'Ocellaris clownfish', 'yes', 'The classic false percula clown; hardy, captive-bred, and happy with or without an anemone.'],
  'Amphiprion percula': [9209, 350, 'Percula clownfish', 'yes', 'The true percula, with thicker black margins than the ocellaris; widely captive-bred.'],
  'Amphiprion biaculeatus': [6632, 350, 'Maroon clownfish', 'yes', 'The largest common clownfish, often sold as Premnas; females can be territorial.'],
  'Chrysiptera parasema': [12448, 350, 'Yellowtail damselfish', 'yes', 'One of the more peaceful damsels: electric blue with a yellow tail.'],
  'Chromis viridis': [5679, 350, 'Green chromis', 'yes', 'A schooling damselfish for the open water column of a larger tank.'],
  'Dascyllus aruanus': [5110, 350, 'Three-stripe damselfish', 'yes', 'Tough and striking, but aggressive as it grows; plan tankmates around it.'],
  'Zebrasoma flavescens': [6018, 412, 'Yellow tang', 'yes', 'The bright yellow grazer of reef tanks; needs swimming room and plenty of algae.'],
  'Paracanthurus hepatus': [6017, 412, 'Blue tang', 'yes', 'The palette surgeonfish; active and fast-growing, so it needs a large tank.'],
  'Acanthurus leucosternon': [1257, 412, 'Powder blue tang', 'yes', 'A beautiful but sensitive surgeonfish that is prone to stress and ich.'],
  'Zebrasoma xanthurum': [12023, 412, 'Purple tang', 'yes', 'A deep purple tang from the Red Sea; territorial with other tangs.'],
  'Centropyge loriculus': [7814, 460, 'Flame angelfish', 'with caution', 'A vivid dwarf angel that may pick at corals and clam mantles.'],
  'Centropyge bispinosa': [5458, 460, 'Coral beauty angelfish', 'with caution', 'A hardy dwarf angel; some individuals nip at soft corals.'],
  'Pomacanthus imperator': [6504, 460, 'Emperor angelfish', 'no', 'A large angel whose juvenile and adult colors differ completely; eats corals and sponges.'],
  'Gramma loreto': [5281, 293, 'Royal gramma', 'yes', 'A small purple-and-yellow cave dweller; peaceful and hardy.'],
  'Pseudochromis fridmani': [12741, 291, 'Orchid dottyback', 'yes', 'A captive-bred Red Sea dottyback, calmer than most of its family.'],
  'Synchiropus splendidus': [12644, 435, 'Mandarin dragonet', 'yes', 'Stunning but a specialist feeder that needs a mature tank full of copepods.'],
  'Elacatinus oceanops': [3876, 405, 'Neon goby', 'yes', 'A tiny cleaner goby, often captive-bred, that sets up cleaning stations.'],
  'Nemateleotris magnifica': [6629, 410, 'Firefish goby', 'yes', 'Hovers near its burrow and darts in when startled; keep a tight lid.'],
  'Amblygobius phalaena': [7198, 405, 'Banded sleeper goby', 'yes', 'Sifts sand all day, which keeps the sand bed turned over.'],
  'Salarias fasciatus': [6058, 392, 'Lawnmower blenny', 'yes', 'A comical algae grazer that perches on rock and needs algae to eat.'],
  'Ecsenius bicolor': [6033, 392, 'Bicolor blenny', 'with caution', 'A lively rock-hopping blenny; now and then one nips at corals.'],
  'Pterapogon kauderni': [15426, 304, 'Banggai cardinalfish', 'yes', 'A mouthbrooder that is easy to breed in captivity; buy captive-bred.'],
  'Sphaeramia nematoptera': [5778, 304, 'Pajama cardinalfish', 'yes', 'A calm, slow schooling cardinal with big eyes and polka dots.'],
  'Pterois volitans': [5195, 264, 'Red lionfish', 'with caution', 'Leaves corals alone but eats small fish and shrimp; its spines are venomous.'],
  'Labroides dimidiatus': [5459, 362, 'Bluestreak cleaner wrasse', 'yes', 'Cleans other fish in the wild but often starves in aquariums; best left in the reef.'],
  'Halichoeres chrysus': [4855, 362, 'Yellow coris wrasse', 'yes', 'A bright wrasse that buries itself in sand at night and hunts pests by day.'],
  'Pseudanthias squamipinnis': [6568, 797, 'Lyretail anthias', 'yes', 'A schooling planktivore that needs several feedings a day.'],
  'Chelmon rostratus': [5483, 343, 'Copperband butterflyfish', 'with caution', 'Famous for eating Aiptasia, but can also pick at some corals and tube worms.'],
  'Hippocampus kuda': [5955, 258, 'Spotted seahorse', 'yes', 'A slow grazer best kept in a species tank with gentle flow and frozen mysis.'],
  'Siganus vulpinus': [4629, 413, 'Foxface rabbitfish', 'with caution', 'An algae eater with venomous spines that may nibble some corals.'],
  'Oxycirrhites typus': [5833, 352, 'Longnose hawkfish', 'with caution', 'Perches on rock and gorgonians; will eat small shrimp.'],
  'Canthigaster valentini': [6544, 448, 'Valentini puffer', 'with caution', 'A small sharpnose puffer that may nip at inverts and fins.'],
  'Opistognathus aurifrons': [3684, 366, 'Yellowhead jawfish', 'yes', 'Digs a burrow in deep sand and hovers above it; jumps, so keep a lid.'],
};

function getArrayBuffer(filePath) {
  const buffer = readFileSync(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function loadParquet(name, columns) {
  let rows = [];
  await parquetRead({ file: getArrayBuffer(resolve(ROOT, `fishbase_${name}.parquet`)), columns, rowFormat: 'object', onComplete: (d) => { rows = d; } });
  return rows;
}

const clean = (v) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const flag = (v) => Number(v) === -1 || Number(v) === 1;

function firstByCode(rows) {
  const map = new Map();
  for (const row of rows) if (!map.has(row.SpecCode)) map.set(row.SpecCode, row);
  return map;
}

function trophicLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 2.8) return 'Herbivore / Detritivore';
  if (n < 3.8) return 'Omnivore';
  return 'Carnivore / Piscivore';
}

function buildRecord(row, meta, estimate, ecology, repro, foodRows) {
  const [, famCode, tradeName, reefSafe, note] = meta;
  const scientificName = `${row.Genus} ${row.Species}`;
  const comment = clean(row.Comments);
  const foods = [...new Set(foodRows.map((f) => clean(f.Foodname || f.FoodIII || f.FoodII || f.FoodI)).filter((n) => n && n.toLowerCase() !== 'unidentified'))];
  const guild = [repro?.RepGuild1, repro?.RepGuild2].filter(Boolean).map(clean).join('; ');
  const waterTypes = [flag(row.Fresh) && 'freshwater', flag(row.Brack) && 'brackish', flag(row.Saltwater) && 'marine'].filter(Boolean);
  const length = Number(row.Length ?? estimate?.MaxLengthTL);
  const reefLine = reefSafe === 'yes' ? 'Generally reef safe.' : reefSafe === 'no' ? 'Not reef safe.' : 'Reef safe with caution.';
  return {
    specCode: Number(row.SpecCode),
    scientificName,
    genus: row.Genus,
    species: row.Species,
    commonName: tradeName,
    fishbaseCommonName: clean(row.FBname) || null,
    family: FAMILY_BY_CODE[famCode],
    type: 'fish',
    maxLengthCm: Number.isFinite(length) && length > 0 ? Math.round(length * 100) / 100 : null,
    masterPhotoUrl: '',
    tankMetrics: { difficulty: 'Unknown' },
    enhanced: false,
    waterTypes,
    waterTypesSource: 'fishbase',
    marine: { reefSafe },
    sources: [{ name: 'FishBase', url: `https://www.fishbase.se/summary/${row.Genus}-${row.Species}.html`, type: 'Scientific data' }],
    ecology: { comments: comment || 'FishBase has limited ecology notes for this species.' },
    diet: {
      trophicLevel: trophicLabel(estimate?.Troph ?? ecology?.DietTroph ?? ecology?.FoodTroph),
      fooditems: foods.length ? foods.join(', ') : 'Specific food items are not listed in the local FishBase extract.',
      feedingPlaybook: '',
    },
    reproduction: {
      spawningTrait: guild ? `FishBase reproductive guild: ${guild}.` : 'Breeding details are not reported in the local FishBase extract.',
      layoutRequirement: 'Species-specific breeding setup is not reported in the local extract; check specialist guidance.',
      comments: [repro?.ReproMode && `Reproductive mode: ${clean(repro.ReproMode)}.`, repro?.Fertilization && `Fertilization: ${clean(repro.Fertilization)}.`, repro?.ParentalCare && `Parental care: ${clean(repro.ParentalCare)}.`].filter(Boolean).join(' ') || 'FishBase has limited breeding notes for this species.',
    },
    personality: {
      vibeLine: { casual: note, pro: `${scientificName}; marine ${FAMILY_BY_CODE[famCode]}. ${reefLine}` },
      flavorText: {
        casual: `${note} ${reefLine}`,
        pro: `${scientificName} (${clean(row.FBname) || tradeName}). ${reefLine} Natural-history claims are from FishBase; check captive care with specialist guidance.`,
      },
    },
  };
}

async function main() {
  const catalog = JSON.parse(readFileSync(PUBLIC_PATH, 'utf8'));
  const mirror = JSON.parse(readFileSync(ROOT_PATH, 'utf8'));
  if (JSON.stringify(catalog) !== JSON.stringify(mirror)) throw new Error('Catalog mirrors differ; reconcile them first.');
  const existingCodes = new Set(catalog.map((r) => Number(r.specCode)));
  const existingNames = new Set(catalog.map((r) => String(r.scientificName).toLowerCase()));

  const [speciesRows, estimateRows, ecologyRows, reproRows, foodRows] = await Promise.all([
    loadParquet('species', ['SpecCode', 'Genus', 'Species', 'FamCode', 'Fresh', 'Brack', 'Saltwater', 'FBname', 'Length', 'Comments']),
    loadParquet('estimate', ['SpecCode', 'MaxLengthTL', 'Troph']),
    loadParquet('ecology', ['SpecCode', 'DietTroph', 'FoodTroph']),
    loadParquet('reproduc', ['SpecCode', 'ReproMode', 'Fertilization', 'RepGuild1', 'RepGuild2', 'ParentalCare']),
    loadParquet('fooditems', ['SpecCode', 'FoodI', 'FoodII', 'FoodIII', 'Foodname']),
  ]);
  const byName = new Map(speciesRows.map((r) => [`${r.Genus} ${r.Species}`.toLowerCase(), r]));
  const estimates = firstByCode(estimateRows);
  const ecology = firstByCode(ecologyRows);
  const repro = firstByCode(reproRows);
  const foods = new Map();
  for (const f of foodRows) { if (!foods.has(f.SpecCode)) foods.set(f.SpecCode, []); foods.get(f.SpecCode).push(f); }

  const additions = [];
  const problems = [];
  for (const [name, meta] of Object.entries(BATCH)) {
    const row = byName.get(name.toLowerCase());
    if (!row) { problems.push(`not in FishBase: ${name}`); continue; }
    if (Number(row.SpecCode) !== meta[0]) problems.push(`SpecCode for ${name}: expected ${meta[0]}, found ${row.SpecCode}`);
    if (Number(row.FamCode) !== meta[1]) problems.push(`FamCode for ${name}: expected ${meta[1]}, found ${row.FamCode}`);
    if (!flag(row.Saltwater)) problems.push(`not marine in FishBase: ${name}`);
    if (existingCodes.has(Number(row.SpecCode))) problems.push(`SpecCode already in catalog: ${name} (${row.SpecCode})`);
    if (existingNames.has(name.toLowerCase())) problems.push(`already in catalog: ${name}`);
    additions.push(buildRecord(row, meta, estimates.get(row.SpecCode), ecology.get(row.SpecCode), repro.get(row.SpecCode), foods.get(row.SpecCode) || []));
  }
  if (problems.length) throw new Error(`Refusing to write:\n  ${problems.join('\n  ')}`);
  if (new Set(additions.map((a) => a.specCode)).size !== additions.length) throw new Error('Duplicate SpecCodes in the batch.');

  console.log(JSON.stringify({ added: additions.length, total: catalog.length + additions.length, names: additions.map((a) => `${a.commonName} (${a.scientificName}, ${a.specCode})`) }, null, 2));
  if (!WRITE) { console.log('Dry run. Re-run with --write to save.'); return; }
  const serialized = JSON.stringify([...catalog, ...additions], null, 2);
  writeFileSync(PUBLIC_PATH, serialized, 'utf8');
  writeFileSync(ROOT_PATH, serialized, 'utf8');
  console.log('Wrote both catalog mirrors.');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
