/**
 * merge-seriously-fish.mjs
 * 
 * Merges scraped Seriously Fish data into fishbase_master_proposed.json.
 * Only fills fields that are currently missing or placeholder.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const PROPOSED_PATH = resolve(ROOT, 'frontend', 'public', 'fishbase_master_proposed.json');
const SF_PATH = resolve(ROOT, 'seriously_fish_data.json');

const data = JSON.parse(readFileSync(PROPOSED_PATH, 'utf-8'));
const sfData = JSON.parse(readFileSync(SF_PATH, 'utf-8'));

console.log(`Master: ${data.length} species`);
console.log(`Seriously Fish data: ${Object.keys(sfData).length} species\n`);

// Clean up scraped text - remove HTML artifacts, ad links, excessive whitespace
function cleanText(text, maxLen = 400) {
  if (!text) return null;
  return text
    .replace(/Click on the following links[\s\S]*$/i, '') // remove ad/link suffixes
    .replace(/To find other high quality[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, maxLen);
}

// Extract a concise diet description from SF text
function extractDiet(sfDiet) {
  if (!sfDiet) return null;
  let cleaned = cleanText(sfDiet, 300);
  // If it starts with something like "Likely to be..." or "Omnivorous..." keep it
  return cleaned || null;
}

// Extract spawning trait from SF reproduction text
function extractSpawningTrait(sfRepro) {
  if (!sfRepro) return null;
  const text = sfRepro.toLowerCase();
  
  if (text.includes('bubble-nest') || text.includes('bubble nest')) return 'Bubble nest builder';
  if (text.includes('mouthbrood') || text.includes('mouth-brood') || text.includes('mouth brood')) return 'Mouthbrooder';
  if (text.includes('livebearer') || text.includes('live-bearer') || text.includes('internal fertilisation')) return 'Livebearer';
  if (text.includes('cave spawn') || text.includes('cave-spawn') || text.includes('deposits eggs in a cave') || text.includes('in caves')) return 'Cave spawner';
  if (text.includes('egg scatter') || text.includes('egg-scatter') || text.includes('scatter') && text.includes('egg')) return 'Egg scatterer';
  if (text.includes('substrate spawn') || text.includes('on a flat surface') || text.includes('on the substrate')) return 'Substrate spawner';
  if (text.includes('adhesive eggs') && text.includes('plants')) return 'Egg depositor — lays adhesive eggs on plants';
  if (text.includes('egg deposit') || text.includes('deposits eggs')) return 'Egg depositor';
  if (text.includes('nest') && !text.includes('bubble')) return 'Nest builder';
  
  // Fallback: extract first sentence about breeding method
  const firstSentence = cleanText(sfRepro, 150);
  if (firstSentence && firstSentence.length > 20) return firstSentence;
  
  return null;
}

let updated = { diet: 0, spawning: 0, reproComments: 0 };

for (const sp of data) {
  const sf = sfData[sp.scientificName];
  if (!sf) continue;

  // Fill diet.fooditems if currently missing/placeholder
  if (sp.diet) {
    const currentDiet = sp.diet.fooditems;
    if (!currentDiet || currentDiet === '' || currentDiet === 'Information arriving soon') {
      const newDiet = extractDiet(sf.diet);
      if (newDiet) {
        sp.diet.fooditems = newDiet;
        updated.diet++;
      }
    }
  }

  // Fill reproduction.spawningTrait if currently missing/placeholder
  if (sp.reproduction) {
    const currentSpawn = sp.reproduction.spawningTrait;
    if (!currentSpawn || currentSpawn === '' || currentSpawn === 'Information arriving soon') {
      const newSpawn = extractSpawningTrait(sf.reproduction);
      if (newSpawn) {
        sp.reproduction.spawningTrait = newSpawn;
        updated.spawning++;
      }
    }
  }

  // Fill reproduction.comments if currently missing/placeholder
  if (sp.reproduction && sf.reproduction) {
    const currentComments = sp.reproduction.comments;
    if (!currentComments || currentComments === '' || currentComments === 'Information arriving soon') {
      const cleaned = cleanText(sf.reproduction, 500);
      if (cleaned) {
        sp.reproduction.comments = cleaned;
        updated.reproComments++;
      }
    }
  }
}

console.log('=== MERGE RESULTS ===');
console.log(`  diet.fooditems filled: ${updated.diet}`);
console.log(`  spawningTrait filled: ${updated.spawning}`);
console.log(`  reproduction.comments filled: ${updated.reproComments}`);

// Validate and save
const jsonStr = JSON.stringify(data, null, 2);
JSON.parse(jsonStr); // round-trip test
console.log(`\n  ✅ JSON valid`);

// Final audit
const missingDiet = data.filter(s => !s.diet?.fooditems || s.diet.fooditems === '' || s.diet.fooditems === 'Information arriving soon').length;
const missingSpawn = data.filter(s => !s.reproduction?.spawningTrait || s.reproduction.spawningTrait === '' || s.reproduction.spawningTrait === 'Information arriving soon').length;

console.log(`\n=== POST-MERGE AUDIT ===`);
console.log(`  diet.fooditems still missing: ${missingDiet}`);
console.log(`  spawningTrait still missing: ${missingSpawn}`);

writeFileSync(PROPOSED_PATH, jsonStr, 'utf-8');
console.log(`\n✅ Saved: ${PROPOSED_PATH} (${(jsonStr.length/1024).toFixed(0)} KB)`);
