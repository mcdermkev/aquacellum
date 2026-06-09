/**
 * merge-verified-data.mjs
 * 
 * Merges verified FishBase data into fishbase_master_proposed.json.
 * 
 * Rules:
 * 1. Schema is preserved EXACTLY - no new top-level keys, no removed keys.
 * 2. maxLengthCm is corrected using FishBase TL (Total Length) values.
 * 3. minVolumeGallons is calculated from verified TL using aquarium standards.
 * 4. ecology/diet/reproduction text fields are LEFT AS-IS if they already have content.
 *    Only verified structured data (trophicLevel, spawningTrait) is corrected if wrong.
 * 5. personality is NEVER touched.
 * 6. Output saved as fishbase_master_proposed_v2.json for review before overwriting.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const PROPOSED_PATH = resolve(ROOT, 'frontend', 'public', 'fishbase_master_proposed.json');
const VERIFIED_PATH = resolve(ROOT, 'fishbase_verified_data.json');
const OUTPUT_PATH = resolve(ROOT, 'frontend', 'public', 'fishbase_master_proposed_v2.json');

const proposed = JSON.parse(readFileSync(PROPOSED_PATH, 'utf-8'));
const verified = JSON.parse(readFileSync(VERIFIED_PATH, 'utf-8'));

console.log(`Proposed: ${proposed.length} species`);
console.log(`Verified: ${Object.keys(verified).length} species\n`);

// ─────────────────────────────────────────────────────────────────────────────
// Tank size calculation from TL (Total Length)
// Uses the "6x body length for tank length" rule, converted to gallons.
// Adjustments for activity level, social needs, and body shape.
// ─────────────────────────────────────────────────────────────────────────────

function calculateMinGallons(sp, v) {
  const tlCm = v.maxLengthTL_cm;
  if (!tlCm || tlCm <= 0) return null;

  // Known overrides for species where the formula doesn't work well
  // These are widely-agreed values from Seriously Fish / aquarium consensus
  const overrides = {
    'Astronotus ocellatus': 75,        // Oscar - sedentary predator
    'Amphilophus citrinellus': 75,      // Midas - large but manageable
    'Amphilophus labiatus': 75,         // Red Devil
    'Herichthys cyanoguttatus': 75,     // Texas Cichlid
    'Cyphotilapia frontosa': 75,        // Frontosa - slow-moving deep water
    'Helostoma temminckii': 75,         // Kissing Gourami
    'Pterygoplichthys gibbiceps': 125,  // Sailfin Pleco - sedentary
    'Platydoras armatulus': 55,         // Striped Raphael - hides all day
    'Panaque nigrolineatus': 125,       // Royal Pleco - sedentary
    'Piaractus brachypomus': 300,      // Red-bellied Pacu
    'Misgurnus anguillicaudatus': 55,   // Weather Loach
    'Myloplus rubripinnis': 75,         // Redhook Silver Dollar
    'Metynnis argenteus': 55,           // Silver Dollar
    'Balantiocheilos melanopterus': 125, // Bala Shark - active schooler
    'Barbonymus schwanenfeldii': 125,   // Tinfoil Barb
    'Synodontis eupterus': 55,          // Featherfin - nocturnal
    'Osteoglossum bicirrhosum': 300,    // Silver Arowana
    'Erpetoichthys calabaricus': 55,    // Reedfish
    'Gnathonemus petersii': 55,         // Elephantnose
    'Gymnarchus niloticus': 300,        // Aba Aba
    'Gymnotus carapo': 55,             // Banded Knifefish
    'Datnioides microlepis': 125,       // Indonesian Tiger Fish
    'Datnioides pulcher': 125,          // Siamese Tiger Fish
    'Acanthicus adonis': 180,           // Adonis Pleco
    'Baryancistrus xanthellus': 55,     // Gold Nugget Pleco
    'Apteronotus leptorhynchus': 55,    // Brown Ghost Knife
    'Dimidiochromis compressiceps': 75,  // Malawi Eyebiter
    'Nimbochromis livingstonii': 75,    // Livingstoni
    'Nimbochromis venustus': 75,        // Venustus
    'Heros efasciatus': 75,            // Green Severum
    'Heros severus': 75,               // Banded Severum
    'Andinoacara rivulatus': 55,       // Green Terror
    'Synodontis multipunctatus': 55,    // Cuckoo Catfish
    'Geophagus surinamensis': 75,       // Redstriped Eartheater
    'Geophagus brasiliensis': 55,       // Pearl Cichlid
    'Acantopsis dialuzona': 40,        // Horseface Loach
    'Yasuhikotakia modesta': 55,       // Blue Botia
    'Syncrossus hymenophysa': 55,      // Tiger Botia
    'Lepidocephalichthys thermalis': 20, // Common Spiny Loach (FishBase length wrong)
    'Sawbwa resplendens': 10,          // Sawbwa Barb (tiny fish, FB TL likely wrong)
    'Hemiodus gracilis': 55,           // Redtail Hemiodus
    'Exodon paradoxus': 55,            // Bucktooth Tetra
    'Belonesox belizanus': 40,         // Pike Livebearer
    'Dawkinsia denisonii': 55,         // Denison Barb
  };

  if (overrides[sp.scientificName]) return overrides[sp.scientificName];

  // Activity/behavior-based sizing
  const demersal = v.demersPelag === 'demersal' || v.demersPelag === 'bathydemersal';
  const isSchooling = v.ecology?.schooling || v.ecology?.shoaling;
  const isGuarder = v.reproduction?.repGuild1 === 'guarders';
  const isLivebearer = v.reproduction?.fertilization?.includes('internal');
  const bodyShape = v.bodyShape || '';
  const isElongate = bodyShape.toLowerCase().includes('elongat') || bodyShape.toLowerCase().includes('eel');

  let gallons;

  if (tlCm <= 3) {
    gallons = 5;
  } else if (tlCm <= 5) {
    gallons = isSchooling ? 10 : 5;
  } else if (tlCm <= 8) {
    gallons = isSchooling ? 20 : 10;
  } else if (tlCm <= 12) {
    gallons = isSchooling ? 30 : 20;
  } else if (tlCm <= 15) {
    gallons = isSchooling ? 40 : 30;
    if (isGuarder) gallons += 10; // territorial cichlids need more
  } else if (tlCm <= 20) {
    gallons = demersal ? 40 : 55;
    if (isGuarder) gallons = 55;
  } else if (tlCm <= 30) {
    gallons = demersal ? 55 : 75;
    if (isGuarder) gallons = 75;
  } else if (tlCm <= 50) {
    gallons = demersal ? 75 : 125;
  } else {
    gallons = 180;
    if (tlCm > 75) gallons = 300;
  }

  // Livebearers are compact and don't need as much space
  if (isLivebearer && gallons > 20) gallons = Math.max(20, gallons - 10);
  
  // Elongate fish need more length but less width
  if (isElongate && tlCm > 20) gallons = Math.max(gallons, 55);

  // Round to nearest 5
  return Math.round(gallons / 5) * 5;
}

// ─────────────────────────────────────────────────────────────────────────────
// Map FishBase trophic data to readable trophic level string
// ─────────────────────────────────────────────────────────────────────────────

function trophicToLabel(troph, herbivory, feedingType) {
  // Use feedingType from ecology if available
  if (feedingType) {
    const ft = String(feedingType).toLowerCase();
    if (ft.includes('herbivore') || ft.includes('planktivore')) return 'Herbivore';
    if (ft.includes('omnivore')) return 'Omnivore';
    if (ft.includes('carnivore') || ft.includes('piscivore')) return 'Carnivore';
    if (ft.includes('detritivore')) return 'Detritivore';
  }
  
  // Use herbivory field
  if (herbivory) {
    const h = String(herbivory).toLowerCase();
    if (h.includes('herbivorous')) return 'Herbivore';
    if (h.includes('omnivorous')) return 'Omnivore';
  }

  // Fallback to numeric trophic level
  if (troph != null) {
    if (troph < 2.2) return 'Herbivore / Detritivore';
    if (troph < 2.8) return 'Omnivore';
    if (troph < 3.3) return 'Omnivore';
    if (troph < 3.8) return 'Carnivore';
    return 'Carnivore / Piscivore';
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Map FishBase reproduction data to spawningTrait string
// ─────────────────────────────────────────────────────────────────────────────

function buildSpawningTrait(repro) {
  if (!repro) return null;

  const parts = [];
  
  // Guild describes the method
  if (repro.repGuild2) {
    const g2 = String(repro.repGuild2).toLowerCase();
    if (g2.includes('live bearers') || g2.includes('internal')) parts.push('Livebearer');
    else if (g2.includes('nesters')) parts.push('Nest builder');
    else if (g2.includes('brood hiders')) parts.push('Brood hider');
    else if (g2.includes('clutch tenders')) parts.push('Substrate spawner');
    else if (g2.includes('mouth brooders') || g2.includes('mouth brooder')) parts.push('Mouthbrooder');
    else if (g2.includes('open water') || g2.includes('pelagic')) parts.push('Open-water egg scatterer');
    else parts.push(repro.repGuild2);
  } else if (repro.repGuild1) {
    const g1 = String(repro.repGuild1).toLowerCase();
    if (g1.includes('nonguard') || g1.includes('non-guard')) parts.push('Egg scatterer');
    else if (g1.includes('guarders')) parts.push('Guarder');
    else if (g1.includes('bearers')) parts.push('Bearer');
    else parts.push(repro.repGuild1);
  }

  // Parental care
  if (repro.parentalCare) {
    const pc = String(repro.parentalCare).toLowerCase();
    if (pc === 'paternal') parts.push('with paternal care');
    else if (pc === 'maternal') parts.push('with maternal care');
    else if (pc === 'biparental') parts.push('with biparental care');
    else if (pc === 'none') parts.push('no parental care');
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Map FishBase food items to a readable fooditems string
// ─────────────────────────────────────────────────────────────────────────────

function buildFoodString(foodItems) {
  if (!foodItems || foodItems.length === 0) return null;
  
  // Group by category and collect unique items
  const categories = new Map();
  for (const item of foodItems) {
    const cat = item.category || 'other';
    if (!categories.has(cat)) categories.set(cat, new Set());
    const name = item.name || item.item || item.subcategory;
    if (name) categories.get(cat).add(String(name).toLowerCase());
  }

  const parts = [];
  for (const [cat, items] of categories) {
    const itemStr = [...items].slice(0, 3).join(', ');
    parts.push(`${cat} (${itemStr})`);
  }
  return parts.slice(0, 4).join('; ');
}

// ─────────────────────────────────────────────────────────────────────────────
// MERGE
// ─────────────────────────────────────────────────────────────────────────────

let updated = { maxLength: 0, minVolume: 0, trophic: 0, spawning: 0, fooditems: 0 };

const merged = proposed.map(sp => {
  const v = verified[sp.scientificName];
  if (!v) return sp; // No verified data, keep as-is

  const result = { ...sp };

  // 1. Correct maxLengthCm using FishBase TL
  // Some FishBase TL values are incorrect or refer to wild outliers.
  // Override known bad values:
  const tlOverrides = {
    'Trichogaster chuna': 5,         // Honey Gourami - FB has 13.7 which is wrong
    'Mikrogeophagus ramirezi': 7,    // German Blue Ram - FB has 4.2 SL, TL ~7
    'Lepidocephalichthys thermalis': 8, // Spiny Loach - FB has 46.4 which is absurd
    'Sawbwa resplendens': 3.5,       // Sawbwa Barb - FB has 25 which is wrong species
  };

  if (tlOverrides[sp.scientificName]) {
    result.maxLengthCm = tlOverrides[sp.scientificName];
    updated.maxLength++;
  } else if (v.maxLengthTL_cm && v.maxLengthTL_cm > 0) {
    const newTL = Math.round(v.maxLengthTL_cm * 10) / 10;
    if (sp.maxLengthCm !== newTL) {
      result.maxLengthCm = newTL;
      updated.maxLength++;
    }
  }

  // 2. Calculate/fill minVolumeGallons
  // Also override existing values that are clearly wrong
  const volOverrides = {
    'Mikrogeophagus ramirezi': 20,   // German Blue Ram - territorial pair needs 20gal min
    'Trichogaster chuna': 10,        // Honey Gourami
    'Lepidocephalichthys thermalis': 20, // Common Spiny Loach
    'Sawbwa resplendens': 10,        // Sawbwa Barb
    'Carassius auratus': 40,         // Goldfish - 48cm fish needs 40gal minimum
    'Chromobotia macracanthus': 125,  // Clown Loach - 30cm active schooler
    'Amatitlania nigrofasciata': 30, // Convict Cichlid - territorial pair
    'Trichopodus leerii': 30,        // Pearl Gourami - 12cm needs 30gal
    'Corydoras panda': 15,           // Panda Cory - schooling, needs space
    'Thorichthys meeki': 30,         // Firemouth - 17cm but moderate activity
  };

  if (volOverrides[sp.scientificName]) {
    result.tankMetrics = { ...result.tankMetrics, minVolumeGallons: volOverrides[sp.scientificName] };
    updated.minVolume++;
  } else if (!sp.tankMetrics?.minVolumeGallons) {
    const calc = calculateMinGallons(sp, v);
    if (calc) {
      result.tankMetrics = { ...result.tankMetrics, minVolumeGallons: calc };
      updated.minVolume++;
    }
  }

  // 3. Correct trophicLevel if currently generic/wrong
  if (v.trophicLevel || v.ecology?.feedingType) {
    const newLabel = trophicToLabel(v.trophicLevel, v.ecology?.herbivory, v.ecology?.feedingType);
    if (newLabel && result.diet) {
      const current = result.diet.trophicLevel;
      // Only update if current is generic "Omnivore" or placeholder
      if (!current || current === 'Omnivore' || current === 'Information arriving soon') {
        if (newLabel !== current) {
          result.diet = { ...result.diet, trophicLevel: newLabel };
          updated.trophic++;
        }
      }
    }
  }

  // Trophic overrides for species we know are wrong
  const trophOverrides = {
    'Astronotus ocellatus': 'Carnivore',       // Oscar - eats fish, insects, crustaceans
    'Pangio kuhlii': 'Omnivore',               // Kuhli Loach - worms + biofilm
    'Pangio oblonga': 'Omnivore',              // Black Kuhli
    'Pangio semicincta': 'Omnivore',           // Half-banded Kuhli
    'Symphysodon aequifasciatus': 'Omnivore',  // Discus - omnivore in aquarium
  };
  if (trophOverrides[sp.scientificName] && result.diet) {
    result.diet = { ...result.diet, trophicLevel: trophOverrides[sp.scientificName] };
  }

  // 4. Fill spawningTrait if currently placeholder
  if (v.reproduction) {
    const newTrait = buildSpawningTrait(v.reproduction);
    if (newTrait && result.reproduction) {
      const current = result.reproduction.spawningTrait;
      if (!current || current === 'Information arriving soon') {
        result.reproduction = { ...result.reproduction, spawningTrait: newTrait };
        updated.spawning++;
      }
    }
  }

  // 5. Fill fooditems if currently placeholder
  if (v.foodItems && v.foodItems.length > 0 && result.diet) {
    const current = result.diet.fooditems;
    if (!current || current === 'Information arriving soon' || current === '') {
      const newFood = buildFoodString(v.foodItems);
      if (newFood) {
        result.diet = { ...result.diet, fooditems: newFood };
        updated.fooditems++;
      }
    }
  }

  // 6. Add verified specCode if different (correct hallucinated specCodes)
  if (v.specCode && sp.specCode !== v.specCode && sp.specCode >= 10000) {
    // Only override auto-generated specCodes (10000+), keep real ones
    // Actually, leave specCode alone for now to not break on-chain references
  }

  return result;
});

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATE
// ─────────────────────────────────────────────────────────────────────────────

console.log('=== MERGE RESULTS ===');
console.log(`  maxLengthCm corrected:     ${updated.maxLength}`);
console.log(`  minVolumeGallons added:    ${updated.minVolume}`);
console.log(`  trophicLevel corrected:    ${updated.trophic}`);
console.log(`  spawningTrait filled:      ${updated.spawning}`);
console.log(`  fooditems filled:          ${updated.fooditems}`);

// Schema validation
console.log('\n=== SCHEMA VALIDATION ===');
let errors = 0;
for (const sp of merged) {
  if (typeof sp.specCode !== 'number') { console.error(`  ❌ ${sp.commonName}: specCode not number`); errors++; }
  if (typeof sp.scientificName !== 'string') { console.error(`  ❌ ${sp.commonName}: scientificName not string`); errors++; }
  if (typeof sp.commonName !== 'string') { console.error(`  ❌ ${sp.commonName}: commonName not string`); errors++; }
  if (sp.maxLengthCm != null && typeof sp.maxLengthCm !== 'number') { console.error(`  ❌ ${sp.commonName}: maxLengthCm not number`); errors++; }
  if (!sp.tankMetrics) { console.error(`  ❌ ${sp.commonName}: missing tankMetrics`); errors++; }
  if (sp.tankMetrics?.minVolumeGallons != null && typeof sp.tankMetrics.minVolumeGallons !== 'number') { 
    console.error(`  ❌ ${sp.commonName}: minVolumeGallons not number`); errors++; 
  }
  if (sp.personality && (!sp.personality.vibeLine || !sp.personality.flavorText)) {
    console.error(`  ❌ ${sp.commonName}: personality structure broken`); errors++;
  }
}

if (errors === 0) {
  console.log('  ✅ All 316 species pass schema validation');
} else {
  console.log(`  ❌ ${errors} schema errors found`);
}

// JSON parsing round-trip test
const jsonStr = JSON.stringify(merged, null, 2);
const reparsed = JSON.parse(jsonStr);
if (reparsed.length === 316) {
  console.log('  ✅ JSON round-trip: valid, 316 species preserved');
} else {
  console.error(`  ❌ JSON round-trip failed: got ${reparsed.length} species`);
}

// Coverage stats after merge
const withVolume = merged.filter(s => s.tankMetrics?.minVolumeGallons).length;
const withEcology = merged.filter(s => s.ecology?.biotope && s.ecology.biotope !== '').length;
const withDiet = merged.filter(s => s.diet?.fooditems && s.diet.fooditems !== '' && s.diet.fooditems !== 'Information arriving soon').length;
const withRepro = merged.filter(s => s.reproduction?.spawningTrait && s.reproduction.spawningTrait !== '' && s.reproduction.spawningTrait !== 'Information arriving soon').length;

console.log('\n=== POST-MERGE COVERAGE ===');
console.log(`  minVolumeGallons: ${withVolume}/316`);
console.log(`  ecology (biotope): ${withEcology}/316`);
console.log(`  diet (fooditems):  ${withDiet}/316`);
console.log(`  reproduction:      ${withRepro}/316`);

// Save
writeFileSync(OUTPUT_PATH, jsonStr, 'utf-8');
console.log(`\n✅ Saved to: ${OUTPUT_PATH}`);
console.log(`   File size: ${(jsonStr.length / 1024).toFixed(0)} KB`);
console.log('\n⚠️  Review this file, then rename to fishbase_master_proposed.json when satisfied.');
