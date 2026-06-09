/**
 * fill-species-data.cjs
 * 
 * Enriches the proposed species catalog (fishbase_master_proposed.json) by querying the
 * Gemini API for species details when they are currently using placeholder values.
 * 
 * Usage:
 *   node scripts/fill-species-data.cjs
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const PROPOSED_PATH = path.resolve(__dirname, '../frontend/public/fishbase_master_proposed.json');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY || GEMINI_API_KEY.trim() === '') {
  console.error('❌ Error: GEMINI_API_KEY is not defined in your .env file.');
  console.error('Please add GEMINI_API_KEY=your_key_here to the .env file in the root directory.');
  process.exit(1);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Check if a species needs enrichment
function needsEnrichment(sp) {
  // Check placeholders in ecology, diet, reproduction, or missing minVolumeGallons
  const isPlaceholder = (val) => !val || val === 'Information arriving soon' || val === 'Generic Biotope Details';
  
  const badEcology = isPlaceholder(sp.ecology?.comments) || 
                      isPlaceholder(sp.ecology?.biotope) || 
                      isPlaceholder(sp.ecology?.socialBehavior);
                      
  const badDiet = isPlaceholder(sp.diet?.fooditems) || 
                   isPlaceholder(sp.diet?.feedingPlaybook);
                   
  const badRepro = isPlaceholder(sp.reproduction?.spawningTrait) || 
                    isPlaceholder(sp.reproduction?.layoutRequirement) || 
                    isPlaceholder(sp.reproduction?.comments);
                    
  const badVolume = typeof sp.tankMetrics?.minVolumeGallons !== 'number';
  
  const badFamily = isPlaceholder(sp.family);

  return badEcology || badDiet || badRepro || badVolume || badFamily;
}

async function queryGemini(sp) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const existingTemp = sp.tankMetrics?.tempRangeCelsius || [22, 28];
  const existingPh = sp.tankMetrics?.phRange || [6.5, 7.5];
  const existingDiff = sp.tankMetrics?.difficulty || 'Intermediate';

  const prompt = `You are a professional freshwater aquarist and ichthyologist.
Provide accurate scientific taxonomy, husbandry, and biological data for the freshwater species: "${sp.scientificName}" (commonly known as "${sp.commonName}").

Use the following context rules:
- Keep the difficulty as "${existingDiff}" unless it's widely incorrect.
- Temperature: tempCeiling should be consistent with the maximum temperature of the range [${existingTemp[0]}, ${existingTemp[1]}].
- pH: phMin and phMax should overlap or match the range [${existingPh[0]}, ${existingPh[1]}].
- Provide realistic descriptions based on FishBase and professional care registries.
- Do NOT use any placeholders or phrases like "Information arriving soon".
- Write high-quality, practical advice.`;

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          genus: { type: 'string' },
          species: { type: 'string' },
          family: { type: 'string' },
          maxLengthCm: { type: 'number' },
          minVolumeGallons: { type: 'number' },
          ecology: {
            type: 'object',
            properties: {
              comments: { type: 'string' },
              biotope: { type: 'string' },
              phMin: { type: 'number' },
              phMax: { type: 'number' },
              hardnessRange: { type: 'string' },
              tempCeiling: { type: 'number' },
              socialBehavior: { type: 'string' }
            },
            required: ['comments', 'biotope', 'phMin', 'phMax', 'hardnessRange', 'tempCeiling', 'socialBehavior']
          },
          diet: {
            type: 'object',
            properties: {
              trophicLevel: { type: 'string' },
              fooditems: { type: 'string' },
              feedingPlaybook: { type: 'string' }
            },
            required: ['trophicLevel', 'fooditems', 'feedingPlaybook']
          },
          reproduction: {
            type: 'object',
            properties: {
              spawningTrait: { type: 'string' },
              layoutRequirement: { type: 'string' },
              comments: { type: 'string' }
            },
            required: ['spawningTrait', 'layoutRequirement', 'comments']
          }
        },
        required: ['genus', 'species', 'family', 'maxLengthCm', 'minVolumeGallons', 'ecology', 'diet', 'reproduction']
      },
      temperature: 0.2,
      maxOutputTokens: 2048 // Increased to prevent truncation
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error HTTP ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Empty response from Gemini API');
  }

  return JSON.parse(text);
}

// Wrapper with retry capabilities (for 503 / 429 rate limit or JSON parse errors)
async function queryGeminiWithRetry(sp, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const data = await queryGemini(sp);
      return data;
    } catch (err) {
      const is503 = err.message.includes('503') || err.message.includes('UNAVAILABLE') || err.message.includes('demand');
      const isRateLimit = err.message.includes('429') || err.message.includes('quota');
      const isJsonError = err.message.includes('JSON') || err.message.includes('Unexpected token') || err.message.includes('Unterminated');
      
      if (attempt === maxRetries) {
        throw err;
      }
      
      const delay = is503 || isRateLimit ? 12000 * attempt : 4000 * attempt;
      console.warn(`   ⚠️ Attempt ${attempt}/${maxRetries} failed: ${err.message.slice(0, 100)}. Retrying in ${delay / 1000}s...`);
      await sleep(delay);
    }
  }
}

async function main() {
  console.log('🐟 Aquacellum Database Enrichment Tool');
  console.log('======================================');
  
  if (!fs.existsSync(PROPOSED_PATH)) {
    console.error(`Error: Proposed catalog file not found at ${PROPOSED_PATH}`);
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(PROPOSED_PATH, 'utf-8'));
  const toEnrich = catalog.filter(needsEnrichment);

  console.log(`Total species in catalog: ${catalog.length}`);
  console.log(`Species needing enrichment: ${toEnrich.length}`);
  console.log('Starting enrichment pipeline...\n');

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < toEnrich.length; i++) {
    const sp = toEnrich[i];
    const indexInCatalog = catalog.findIndex(s => s.specCode === sp.specCode);

    console.log(`[${i + 1}/${toEnrich.length}] Enriched: ${successCount} | Errors: ${errorCount}`);
    console.log(`👉 Processing: ${sp.commonName} (${sp.scientificName})`);

    try {
      const enrichedData = await queryGeminiWithRetry(sp);
      
      // Merge new data while preserving existing personality & base fields
      catalog[indexInCatalog].genus = enrichedData.genus || catalog[indexInCatalog].genus;
      catalog[indexInCatalog].species = enrichedData.species || catalog[indexInCatalog].species;
      catalog[indexInCatalog].family = enrichedData.family || catalog[indexInCatalog].family;
      catalog[indexInCatalog].maxLengthCm = enrichedData.maxLengthCm || catalog[indexInCatalog].maxLengthCm;
      
      catalog[indexInCatalog].tankMetrics = {
        ...catalog[indexInCatalog].tankMetrics,
        minVolumeGallons: enrichedData.minVolumeGallons
      };

      catalog[indexInCatalog].ecology = {
        comments: enrichedData.ecology.comments,
        biotope: enrichedData.ecology.biotope,
        phMin: enrichedData.ecology.phMin,
        phMax: enrichedData.ecology.phMax,
        hardnessRange: enrichedData.ecology.hardnessRange,
        tempCeiling: enrichedData.ecology.tempCeiling,
        socialBehavior: enrichedData.ecology.socialBehavior
      };

      catalog[indexInCatalog].diet = {
        trophicLevel: enrichedData.diet.trophicLevel,
        fooditems: enrichedData.diet.fooditems,
        feedingPlaybook: enrichedData.diet.feedingPlaybook
      };

      catalog[indexInCatalog].reproduction = {
        spawningTrait: enrichedData.reproduction.spawningTrait,
        layoutRequirement: enrichedData.reproduction.layoutRequirement,
        comments: enrichedData.reproduction.comments
      };

      // Save changes immediately after each successful call
      fs.writeFileSync(PROPOSED_PATH, JSON.stringify(catalog, null, 2), 'utf-8');
      console.log(`   ✅ Success! Fields populated.`);
      successCount++;
    } catch (err) {
      console.error(`   ❌ Failed to enrich ${sp.scientificName} after retries:`, err.message);
      errorCount++;
    }

    // Delay to respect rate limits (Gemini 2.5 Flash Free has generous limits, but 4-5 seconds keeps us extremely safe)
    if (i < toEnrich.length - 1) {
      await sleep(4000);
    }
  }

  console.log('\n======================================');
  console.log('Pipeline Completed.');
  console.log(`Enriched successfully: ${successCount}`);
  console.log(`Failed / skipped: ${errorCount}`);
  console.log(`Proposed database saved -> ${PROPOSED_PATH}`);
  console.log('======================================');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
