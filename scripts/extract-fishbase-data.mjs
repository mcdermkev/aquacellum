/**
 * extract-fishbase-data.mjs
 * 
 * Reads FishBase v25.04 parquet files (from HuggingFace cboettig/fishbase)
 * and builds a comprehensive verified dataset for our 316 species.
 * 
 * Tables used:
 *   - species.parquet: Core taxonomy, max length, body shape, comments
 *   - estimate.parquet: MaxLengthTL, trophic level, temperature preferences
 *   - ecology.parquet: Feeding type, herbivory, schooling behavior
 *   - reproduc.parquet: Reproduction mode, parental care, breeding difficulty
 *   - spawning.parquet: Spawning ground, temp range, fecundity
 *   - fooditems.parquet: Specific prey/food items
 * 
 * Source: https://huggingface.co/datasets/cboettig/fishbase (CC-BY-NC)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parquetRead } from 'hyparquet';

const ROOT = resolve(import.meta.dirname, '..');
const PROPOSED_PATH = resolve(ROOT, 'frontend', 'public', 'fishbase_master_proposed.json');

const proposed = JSON.parse(readFileSync(PROPOSED_PATH, 'utf-8'));
console.log(`Our catalog: ${proposed.length} species\n`);

function getAB(filePath) {
  const buf = readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function loadParquet(name, columns) {
  const path = resolve(ROOT, `fishbase_${name}.parquet`);
  let rows = [];
  await parquetRead({ file: getAB(path), columns, rowFormat: 'object', onComplete: d => { rows = d; } });
  console.log(`  ${name}: ${rows.length} rows`);
  return rows;
}

async function main() {
  console.log('Loading FishBase tables...');

  const [speciesRows, estimateRows, ecologyRows, reproducRows, spawningRows, foodRows] = await Promise.all([
    loadParquet('species', ['SpecCode','Genus','Species','FBname','Length','LTypeMaxM','CommonLength','Fresh','DemersPelag','BodyShapeI','Vulnerability','Comments','LongevityWild','LongevityCaptive','Aquarium']),
    loadParquet('estimate', ['SpecCode','MaxLengthTL','MaxLengthSL','Troph','seTroph','TempPrefMin','TempPrefMean','TempPrefMax']),
    loadParquet('ecology', ['SpecCode','Herbivory2','FeedingType','DietTroph','FoodTroph','Schooling','SchoolingFrequency','Shoaling','ShoalingFrequency']),
    loadParquet('reproduc', ['SpecCode','ReproMode','Fertilization','MatingSystem','SpawnAgg','Spawning','BatchSpawner','RepGuild1','RepGuild2','ParentalCare','RepAquarium']),
    loadParquet('spawning', ['SpecCode','SpawningGround','Spawningarea','TempLow','TempHigh','FecundityMin','FecundityMax']),
    loadParquet('fooditems', ['SpecCode','FoodI','FoodII','FoodIII','Foodname','Commoness']),
  ]);

  // Build lookups
  const specByName = new Map();
  const specByCode = new Map();
  speciesRows.forEach(r => {
    specByName.set(`${r.Genus} ${r.Species}`.toLowerCase(), r);
    specByCode.set(r.SpecCode, r);
  });

  const estimateByCode = new Map();
  estimateRows.forEach(r => estimateByCode.set(r.SpecCode, r));

  const ecoByCode = new Map();
  ecologyRows.forEach(r => ecoByCode.set(r.SpecCode, r));

  const reproducByCode = new Map();
  reproducRows.forEach(r => { if (!reproducByCode.has(r.SpecCode)) reproducByCode.set(r.SpecCode, r); });

  const spawnByCode = new Map();
  spawningRows.forEach(r => { if (!spawnByCode.has(r.SpecCode)) spawnByCode.set(r.SpecCode, r); });

  const foodByCode = new Map();
  foodRows.forEach(r => {
    if (!foodByCode.has(r.SpecCode)) foodByCode.set(r.SpecCode, []);
    foodByCode.get(r.SpecCode).push(r);
  });

  // Match and build output
  console.log('\nMatching species...');
  const output = {};
  let matched = 0;
  const unmatched = [];

  for (const sp of proposed) {
    const name = sp.scientificName?.toLowerCase().trim();
    if (!name) continue;

    let fb = specByName.get(name);
    if (!fb && sp.specCode < 10000) fb = specByCode.get(sp.specCode);
    if (!fb) {
      const parts = name.split(' ');
      if (parts.length > 2) fb = specByName.get(`${parts[0]} ${parts[1]}`);
    }
    if (!fb) { unmatched.push(sp.scientificName); continue; }

    matched++;
    const code = fb.SpecCode;
    const est = estimateByCode.get(code);
    const eco = ecoByCode.get(code);
    const repro = reproducByCode.get(code);
    const spawn = spawnByCode.get(code);
    const foods = foodByCode.get(code) || [];

    // Determine best maxLength (prefer TL from estimates, fallback to species table)
    const maxLengthTL = est?.MaxLengthTL || null;
    const maxLengthSL = fb.Length || est?.MaxLengthSL || null;

    output[sp.scientificName] = {
      // Core identification
      specCode: code,
      genus: fb.Genus,
      species: fb.Species,
      fbCommonName: fb.FBname,

      // Size
      maxLengthTL_cm: maxLengthTL,
      maxLengthSL_cm: maxLengthSL,
      commonLength_cm: fb.CommonLength,
      lengthType: fb.LTypeMaxM,

      // Environment
      freshwater: fb.Fresh === 1 || fb.Fresh === -1,
      demersPelag: fb.DemersPelag,
      bodyShape: fb.BodyShapeI,
      vulnerability: fb.Vulnerability,
      longevityWild_years: fb.LongevityWild,
      longevityCaptive_years: fb.LongevityCaptive,
      aquariumSuitability: fb.Aquarium,
      fbComments: fb.Comments,

      // Temperature preferences (from estimates model)
      tempPrefMin: est?.TempPrefMin || null,
      tempPrefMean: est?.TempPrefMean || null,
      tempPrefMax: est?.TempPrefMax || null,

      // Trophic level
      trophicLevel: est?.Troph || eco?.DietTroph || eco?.FoodTroph || null,
      trophicSE: est?.seTroph || null,

      // Ecology
      ecology: eco ? {
        herbivory: eco.Herbivory2,
        feedingType: eco.FeedingType,
        schooling: eco.Schooling,
        schoolingFreq: eco.SchoolingFrequency,
        shoaling: eco.Shoaling,
        shoalingFreq: eco.ShoalingFrequency
      } : null,

      // Reproduction
      reproduction: repro ? {
        reproMode: repro.ReproMode,
        fertilization: repro.Fertilization,
        matingSystem: repro.MatingSystem,
        repGuild1: repro.RepGuild1,
        repGuild2: repro.RepGuild2,
        parentalCare: repro.ParentalCare,
        aquariumBreeding: repro.RepAquarium,
        spawning: repro.Spawning,
        batchSpawner: repro.BatchSpawner === 1
      } : null,

      // Spawning details
      spawning: spawn ? {
        ground: spawn.SpawningGround,
        area: spawn.Spawningarea,
        tempLow: spawn.TempLow,
        tempHigh: spawn.TempHigh,
        fecundityMin: spawn.FecundityMin,
        fecundityMax: spawn.FecundityMax
      } : null,

      // Food items (top entries by commonness)
      foodItems: foods
        .sort((a, b) => {
          const order = { 'very common': 0, 'common': 1, 'uncommon': 2, 'rare': 3 };
          const aKey = String(a.Commoness || '').toLowerCase();
          const bKey = String(b.Commoness || '').toLowerCase();
          return (order[aKey] ?? 4) - (order[bKey] ?? 4);
        })
        .slice(0, 12)
        .map(f => ({
          category: f.FoodI,
          subcategory: f.FoodII,
          item: f.FoodIII,
          name: f.Foodname,
          commonness: f.Commoness
        }))
    };
  }

  // Save
  const outputPath = resolve(ROOT, 'fishbase_verified_data.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  // Stats
  const entries = Object.values(output);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ VERIFIED FISHBASE DATA EXTRACTION COMPLETE`);
  console.log(`${'='.repeat(50)}`);
  console.log(`Matched: ${matched} / ${proposed.length} species`);
  console.log(`Unmatched: ${unmatched.length} (plants, inverts, name mismatches)`);
  console.log(`\nData coverage:`);
  console.log(`  maxLengthTL:      ${entries.filter(v => v.maxLengthTL_cm).length}`);
  console.log(`  maxLengthSL:      ${entries.filter(v => v.maxLengthSL_cm).length}`);
  console.log(`  trophicLevel:     ${entries.filter(v => v.trophicLevel).length}`);
  console.log(`  tempPreferences:  ${entries.filter(v => v.tempPrefMin).length}`);
  console.log(`  ecology:          ${entries.filter(v => v.ecology).length}`);
  console.log(`  reproduction:     ${entries.filter(v => v.reproduction).length}`);
  console.log(`  spawning:         ${entries.filter(v => v.spawning).length}`);
  console.log(`  foodItems:        ${entries.filter(v => v.foodItems.length > 0).length}`);
  console.log(`\nOutput: ${outputPath}`);

  // Show maxLength discrepancies
  console.log(`\n=== MaxLength discrepancies (proposed vs FishBase TL) ===`);
  let disc = 0;
  for (const sp of proposed) {
    const v = output[sp.scientificName];
    if (!v || !v.maxLengthTL_cm || !sp.maxLengthCm) continue;
    const diff = Math.abs(sp.maxLengthCm - v.maxLengthTL_cm);
    if (diff > 1) {
      console.log(`  ${sp.commonName.padEnd(30)} proposed=${sp.maxLengthCm}cm  FishBase TL=${v.maxLengthTL_cm}cm`);
      disc++;
    }
  }
  console.log(`  Total: ${disc} discrepancies > 1cm`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
