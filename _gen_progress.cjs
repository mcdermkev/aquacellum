'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const masterPath = path.join(ROOT, 'frontend', 'public', 'fishbase_master.json');
const specDir = path.join(ROOT, '.kiro', 'specs', 'species-personality');
const batchesDir = path.join(specDir, 'batches');
const progressPath = path.join(specDir, 'progress.md');
const orderPath = path.join(batchesDir, 'batch-order.json');

const BATCH_SIZE = 20;

const data = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
const missing = data.filter((x) => !x.personality);

// --- Flagship-first explicit ordering (highest-traffic aquarium species) ---
// Curated by popularity from common names. Index = priority within tier 0.
const flagship = [
  // Beginner community staples: barbs, danios, minnows, tetras, rasboras
  4766, 4653, 4758, 8195, 10642, 4682, 46294, 10222, 12370, 10881,
  10210, 6147, 4714, 4680, 4773, 3231, 3232, 3233, 10232, 4774,
  // Gouramis / anabantoids, angelfish, discus, classic cichlids
  11201, 10114, 4777, 500, 4717, 11185, 3612, 3615, 3616, 4676,
  15902, 7777, 23347, 10897, 12276, 12063, 6089, 12069, 10835, 4765,
  // Popular corydoras, catfish, plecos, classic tetras
  46235, 10926, 10923, 12199, 10215, 13115, 9599, 67132, 52350, 12219,
  10278, 10247, 10189, 50462, 10656, 10683, 10660, 10664, 10654, 10658,
  // More popular tetras, African + New World cichlids
  10659, 10651, 10674, 12360, 10716, 60560, 10231, 8652, 8572, 60051,
  60044, 47109, 10141, 2343, 2173, 12209, 3614, 4786, 28238, 3617,
  // Popular acaras/cichlids, dwarf cichlids, kribs, gouramis, nano fish,
  // popular rainbowfish & loaches
  4727, 11136, 2389, 52199, 10126, 10125, 10123, 10192, 10204, 10203,
  10219, 10208, 10489, 10516, 70013, 10268, 12255, 24687, 10240, 10238,
];
const flagshipIndex = new Map(flagship.map((c, i) => [c, i]));

// --- Explicit long-tail (obscure / marine / data-artifact names) ---
const tail = new Set([
  10274, // Aba Aba (oddball, rarely kept)
  70009, // Ngarara (Ablennes hians - needlefish, marine)
  70007, // "orange" (Acanthurus olivaceus - tang, marine)
  70017, // Orange-socket surgeonfish (marine)
  70019, // Orange-fin anemonefish (marine)
  70016, // Orange-striped goby (Amblygobius, marine)
  70011, // Super Aloy (Auxis thazard - mackerel/tuna, marine)
  70003, // Tapajos-mudderlaks (foreign-name artifact)
  70014, // Greenstreaked (bad-name artifact)
  70012, // bitterling (artifact)
  70018, // Bitterling (artifact)
  70008, // "neon b" (Red neon blue-eye - artifact name)
  70006, // Dwarf Wrymouth (Cryptacanthodes - marine eelpout)
]);

const has = (str, arr) => arr.some((k) => str.includes(k));

function tierOf(s) {
  const code = s.specCode;
  if (flagshipIndex.has(code)) return 0; // sub-ordered separately
  if (tail.has(code)) return 900;

  const n = (s.commonName || '').toLowerCase();
  const g = (s.genus || '').toLowerCase();

  // Popular inverts
  if (has(n, ['shrimp', 'snail']) ||
      has(g, ['neocaridina', 'caridina', 'palaemonetes', 'physella', 'pomacea', 'neritina', 'planorbella', 'melanoides'])) return 200;
  // Aquarium plants
  if (has(n, ['moss', 'fern', 'sword', 'anubias', 'vallisneria', 'wisteria', 'duckweed', 'frogbit', 'hyssop', 'cryptocoryne', 'ludwigia', 'bucephalandra']) ||
      has(g, ['echinodorus', 'anubias', 'cryptocoryne', 'vallisneria', 'ludwigia', 'hygrophila', 'taxiphyllum', 'vesicularia', 'bucephalandra', 'limnobium', 'lemna', 'leptochilus', 'bacopa', 'microsorum'])) return 210;

  // Corydoras & allies
  if (n.includes('corydoras') || has(g, ['corydoras', 'brochis', 'aspidoras'])) return 100;
  // Tetras / characins (before oddballs so named tetras win)
  if (has(n, ['tetra', 'pencilfish', 'silver dollar', 'pacu', 'splash']) ||
      has(g, ['hyphessobrycon', 'hemigrammus', 'paracheirodon', 'moenkhausia', 'nematobrycon', 'phenacogrammus', 'nannostomus', 'boehlkea', 'inpaichthys', 'thayeria', 'hasemania', 'psalidodon', 'gymnocorymbus', 'petitella', 'copeina', 'copella', 'myloplus', 'metynnis', 'piaractus'])) return 110;
  // Hatchetfish
  if (n.includes('hatchetfish') || has(g, ['carnegiella', 'gasteropelecus', 'thoracocharax'])) return 112;
  // Rasboras & micro-rasboras
  if (n.includes('rasbora') || has(g, ['rasbora', 'boraras', 'trigonostigma', 'brevibora', 'microdevario', 'sundadanio', 'microrasbora'])) return 115;
  // Danios & minnows
  if (has(n, ['danio', 'minnow']) || has(g, ['danio', 'devario', 'tanichthys'])) return 118;
  // Barbs
  if (n.includes('barb') || has(g, ['puntigrus', 'puntius', 'pethia', 'barbodes', 'barbonymus', 'dawkinsia', 'sawbwa'])) return 120;
  // Loaches & algae-eating cyprinids
  if (has(n, ['loach', 'flying fox']) ||
      has(g, ['pangio', 'botia', 'yasuhikotakia', 'syncrossus', 'ambastaia', 'sewellia', 'gastromyzon', 'homaloptera', 'acantopsis', 'lepidocephalichthys', 'misgurnus', 'epalzeorhynchos', 'crossocheilus'])) return 125;
  // Bettas (wild types) & gouramis / anabantoids
  if (has(n, ['betta', 'gourami']) ||
      has(g, ['betta', 'trichopsis', 'trichogaster', 'trichopodus', 'macropodus', 'helostoma'])) return 130;
  // Plecos, loricariids & catfish
  if (has(n, ['pleco', 'catfish', 'synodontis', 'twig', 'whiptail', 'otocinclus']) ||
      has(g, ['ancistrus', 'panaque', 'panaqolus', 'hypancistrus', 'pterygoplichthys', 'baryancistrus', 'acanthicus', 'farlowella', 'rineloricaria', 'sturisomatichthys', 'chaetostoma', 'synodontis', 'pimelodus', 'kryptopterus', 'microglanis', 'bunocephalus', 'agamyxis', 'platydoras', 'liosomadoras', 'duringlanis', 'chaca', 'otocinclus'])) return 135;
  // Livebearers
  if (has(n, ['livebearer', 'limia', 'platy', 'molly', 'swordtail']) ||
      has(g, ['poecilia', 'xiphophorus', 'limia', 'heterandria', 'belonesox'])) return 140;
  // Rainbowfish & blue-eyes & sleeper gobies/gudgeons
  if (has(n, ['rainbowfish', 'blue-eye', 'blue eye', 'gudgeon', 'threadfin']) ||
      has(g, ['melanotaenia', 'pseudomugil', 'iriatherina', 'bedotia', 'chilatherina', 'marosatherina', 'tateurndina', 'hypseleotris'])) return 150;
  // Killifish
  if (has(n, ['killifish', 'notho', 'lyretail', 'flagfish']) ||
      has(g, ['aphyosemion', 'fundulopanchax', 'nothobranchius', 'aplocheilus', 'epiplatys', 'jordanella'])) return 160;
  // Apistogramma & dwarf cichlids
  if (n.includes('dwarf cichlid') ||
      has(g, ['apistogramma', 'nannacara', 'dicrossus', 'laetacara', 'cleithracara', 'biotoecus'])) return 165;
  // New World cichlids (eartheaters, angel-relatives, etc.) + badis
  if (has(n, ['cichlid', 'acara', 'severum', 'eartheater', 'badis']) || n.endsWith(' ram') ||
      has(g, ['geophagus', 'heros', 'mesonauta', 'rocio', 'andinoacara', 'amphilophus', 'herichthys', 'thorichthys', 'pterophyllum', 'symphysodon', 'astronotus', 'amatitlania', 'crenicichla', 'pelvicachromis', 'rubricatochromis', 'badis', 'dario'])) return 168;
  // African rift-lake cichlids (Tanganyika / Malawi), julies, shell dwellers
  if (has(n, ['julie', 'shell dweller', 'mbuna']) ||
      has(g, ['julidochromis', 'neolamprologus', 'lamprologus', 'altolamprologus', 'tropheus', 'cyprichromis', 'chindongo', 'pseudotropheus', 'melanochromis', 'maylandia', 'copadichromis', 'nimbochromis', 'dimidiochromis', 'sciaenochromis', 'aulonocara', 'cyphotilapia', 'steatocranus'])) return 170;
  // Oddballs / monsters / puffers / brackish-ish
  if (has(n, ['arowana', 'knifefish', 'elephantnose', 'reedfish', 'ropefish', 'puffer', 'tiger fish', 'goby', 'halfbeak', 'bush fish', 'aba aba']) ||
      has(g, ['osteoglossum', 'gymnotus', 'apteronotus', 'gnathonemus', 'erpetoichthys', 'carinotetraodon', 'colomesus', 'datnioides', 'brachygobius', 'chlamydogobius', 'nomorhamphus', 'ctenopoma', 'exodon', 'gymnarchus', 'hemiodus'])) return 250;

  return 300; // mid-tail default
}

const ranked = missing
  .map((s) => ({ s, tier: tierOf(s), sub: flagshipIndex.has(s.specCode) ? flagshipIndex.get(s.specCode) : Number.MAX_SAFE_INTEGER }))
  .sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.sub !== b.sub) return a.sub - b.sub; // flagship internal order
    return (a.s.commonName || '').localeCompare(b.s.commonName || '');
  })
  .map((r) => r.s);

// --- Chunk into batches of BATCH_SIZE ---
const batches = [];
for (let i = 0; i < ranked.length; i += BATCH_SIZE) {
  batches.push(ranked.slice(i, i + BATCH_SIZE));
}

// --- Validation ---
const doneCodes = new Set(data.filter((x) => x.personality).map((x) => x.specCode));
const listedCodes = ranked.map((x) => x.specCode);
const overlap = listedCodes.filter((c) => doneCodes.has(c));
const flagshipMissing = flagship.filter((c) => !listedCodes.includes(c));
if (ranked.length !== 316) throw new Error('Expected 316 missing, got ' + ranked.length);
if (overlap.length) throw new Error('Done species leaked into list: ' + overlap.join(','));
if (flagshipMissing.length) console.warn('WARN flagship codes not found in missing set:', flagshipMissing.join(','));

// --- Build progress.md ---
const pad2 = (n) => String(n).padStart(2, '0');
const total = ranked.length;
const numBatches = batches.length;

let md = '';
md += '# Content Pipeline Progress — Species Personality\n\n';
md += 'Tracks the draft -> review -> merge pipeline that adds a `personality`\n';
md += 'block (Casual + Pro `vibeLine` and `flavorText`) to every species in\n';
md += '`frontend/public/fishbase_master.json` that currently lacks one.\n\n';
md += '- **Total species needing content:** ' + total + ' (of 326; the other 10 already have a `personality` block and are excluded here).\n';
md += '- **Batch size:** ' + BATCH_SIZE + '\n';
md += '- **Batches:** ' + numBatches + ' (`Batch 01` … `Batch ' + pad2(numBatches) + '`; the final batch is smaller).\n';
md += '- **Merge key:** `specCode` (stable, unique).\n';
md += '- **Ordering:** flagship-first — highest-traffic aquarium species first so they get the earliest human review; obscure / rarely-kept species trail the end.\n';
md += '- **Companion file:** `batches/batch-order.json` holds the machine-readable `specCode` order per batch (drives draft/merge steps).\n\n';

md += '## How to use this file\n\n';
md += 'Each species row carries three independent checkboxes. Flip them as the\n';
md += 'species moves through the pipeline:\n\n';
md += '- `drafted:` review-sheet content written for the species.\n';
md += '- `reviewed:` content approved (or edited then approved) by a human.\n';
md += '- `merged:` `personality` block written into `fishbase_master.json`.\n\n';

md += '## Per-batch status\n\n';
md += 'Update the counts as batches complete (e.g. `merged 20/20`).\n\n';
md += '| Batch | Species | Drafted | Reviewed | Merged |\n';
md += '| --- | --- | --- | --- | --- |\n';
batches.forEach((b, i) => {
  md += '| Batch ' + pad2(i + 1) + ' | ' + b.length + ' | 0/' + b.length + ' | 0/' + b.length + ' | 0/' + b.length + ' |\n';
});
md += '\n';

batches.forEach((b, i) => {
  md += '## Batch ' + pad2(i + 1) + ' (' + b.length + ' species)\n\n';
  b.forEach((s) => {
    md += '- [ ] ' + s.specCode + ' — ' + s.commonName + ' (' + s.scientificName + ') — drafted: [ ] reviewed: [ ] merged: [ ]\n';
  });
  md += '\n';
});

fs.writeFileSync(progressPath, md, 'utf8');

// --- Build batch-order.json ---
if (!fs.existsSync(batchesDir)) fs.mkdirSync(batchesDir, { recursive: true });
const orderObj = {
  generatedBy: 'task-6 build-progress',
  total,
  batchSize: BATCH_SIZE,
  numBatches,
  ordering: 'flagship-first',
  batches: batches.map((b, i) => ({
    batch: pad2(i + 1),
    specCodes: b.map((s) => s.specCode),
  })),
};
fs.writeFileSync(orderPath, JSON.stringify(orderObj, null, 2) + '\n', 'utf8');

// --- Report ---
console.log('total listed:', total);
console.log('numBatches:', numBatches);
console.log('overlap with done (must be 0):', overlap.length);
console.log('last batch size:', batches[batches.length - 1].length);
console.log('--- Batch 01 ---');
batches[0].forEach((s) => console.log(s.specCode + ' | ' + s.commonName + ' | ' + s.scientificName));
console.log('wrote:', progressPath);
console.log('wrote:', orderPath);
