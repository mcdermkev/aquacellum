/**
 * scrape-seriously-fish.mjs
 * 
 * Scrapes SeriouslyFish.com for species data missing from FishBase.
 * Targets: diet, reproduction, and aquarium tank size.
 * 
 * Usage: node scripts/scrape-seriously-fish.mjs
 * 
 * Rate limiting: 3 second delay between requests to be polite.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const PROPOSED_PATH = resolve(ROOT, 'frontend', 'public', 'fishbase_master_proposed.json');
const OUTPUT_PATH = resolve(ROOT, 'seriously_fish_data.json');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const data = JSON.parse(readFileSync(PROPOSED_PATH, 'utf-8'));

// Find species that still need diet or spawning data
const needsWork = data.filter(sp => {
  const noDiet = !sp.diet?.fooditems || sp.diet.fooditems === '' || sp.diet.fooditems === 'Information arriving soon';
  const noSpawn = !sp.reproduction?.spawningTrait || sp.reproduction.spawningTrait === '' || sp.reproduction.spawningTrait === 'Information arriving soon';
  // Only fish, not plants/inverts
  const isFish = sp.type !== 'plant' && sp.type !== 'invertebrate' && !sp.scientificName.includes(' spp.');
  return isFish && (noDiet || noSpawn);
});

console.log(`Species needing data: ${needsWork.length}`);

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractSection(html, heading) {
  const re = new RegExp(heading + '</h[23]>([\\s\\S]*?)(?=<h[23])', 'i');
  const m = html.match(re);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildUrl(scientificName) {
  // SeriouslyFish URL format: /species/genus-species/
  const parts = scientificName.toLowerCase().split(' ');
  if (parts.length < 2) return null;
  return `https://www.seriouslyfish.com/species/${parts[0]}-${parts[1]}/`;
}

async function scrapeSpecies(sp) {
  const url = buildUrl(sp.scientificName);
  if (!url) return null;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    if (res.status === 404) return null;
    if (!res.ok) return null;

    const html = await res.text();
    
    const diet = extractSection(html, 'Diet');
    const repro = extractSection(html, 'Reproduction');
    const habitat = extractSection(html, 'Habitat');
    const maintenance = extractSection(html, 'Maintenance');
    const maxLen = extractSection(html, 'Maximum Standard Length');

    // Extract tank dimensions from maintenance section
    let tankDimensions = null;
    if (maintenance) {
      const dimMatch = maintenance.match(/(\d+)\s*[x×X]\s*(\d+)\s*[x×X]\s*(\d+)/);
      if (dimMatch) tankDimensions = `${dimMatch[1]}x${dimMatch[2]}x${dimMatch[3]} cm`;
    }

    return {
      url,
      diet: diet ? diet.substring(0, 600) : null,
      reproduction: repro ? repro.substring(0, 600) : null,
      habitat: habitat ? habitat.substring(0, 400) : null,
      tankDimensions,
      maxLength: maxLen ? maxLen.substring(0, 100) : null,
    };
  } catch (err) {
    return null;
  }
}

async function main() {
  const results = {};
  let found = 0;
  let notFound = 0;

  for (let i = 0; i < needsWork.length; i++) {
    const sp = needsWork[i];
    process.stdout.write(`[${i+1}/${needsWork.length}] ${sp.commonName}... `);
    
    const result = await scrapeSpecies(sp);
    
    if (result && (result.diet || result.reproduction)) {
      results[sp.scientificName] = result;
      found++;
      console.log('✅');
    } else {
      notFound++;
      console.log('❌ (not found or no data)');
    }

    // Rate limit: 3 seconds between requests
    if (i < needsWork.length - 1) await delay(3000);

    // Save progress every 20 species
    if ((i + 1) % 20 === 0) {
      writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
      console.log(`  [saved progress: ${found} found so far]`);
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
  
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Done! Found: ${found}, Not found: ${notFound}`);
  console.log(`Saved to: ${OUTPUT_PATH}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
