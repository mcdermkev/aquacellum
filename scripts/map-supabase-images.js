/**
 * map-supabase-images.js
 * 
 * Reads species_rows.csv (Supabase export) and maps image UUIDs to species
 * in fishbase_master.json. Also copies images from migration_assets/ to
 * frontend/public/species-images/ with proper names.
 * 
 * Usage: node scripts/map-supabase-images.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// Simple CSV parser that handles quoted fields with commas
function parseCSV(text) {
  const lines = text.split("\n");
  const headers = lines[0].split(",");
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const row = {};
    let col = 0;
    let pos = 0;
    let inQuotes = false;
    let field = "";

    for (let j = 0; j <= line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if ((ch === "," || j === line.length) && !inQuotes) {
        row[headers[col]?.trim()] = field.trim();
        field = "";
        col++;
      } else {
        field += ch || "";
      }
    }
    rows.push(row);
  }
  return rows;
}

// Main
const csvPath = path.join(ROOT, "species_rows.csv");
const masterPath = path.join(ROOT, "frontend", "public", "fishbase_master.json");
const migrationDir = path.join(ROOT, "migration_assets");
const imagesDir = path.join(ROOT, "frontend", "public", "species-images");

console.log("=== Supabase Image Mapper ===\n");

// Parse CSV
const csvText = fs.readFileSync(csvPath, "utf8");
const supabaseRows = parseCSV(csvText);
console.log(`Supabase rows loaded: ${supabaseRows.length}`);

// Categorize
const plants = supabaseRows.filter(r => r.category === "plant");
const invertebrates = supabaseRows.filter(r => r.category === "invertebrate");
const fish = supabaseRows.filter(r => r.category === "fish");
console.log(`  Fish: ${fish.length} | Plants: ${plants.length} | Invertebrates: ${invertebrates.length} | Other: ${supabaseRows.length - fish.length - plants.length - invertebrates.length}`);

// Load fishbase_master.json
const masterData = JSON.parse(fs.readFileSync(masterPath, "utf8"));
console.log(`\nfishbase_master.json species: ${masterData.length}`);

// Build lookup by scientific name (lowercase)
const masterByName = {};
masterData.forEach((sp, idx) => {
  masterByName[sp.scientificName.toLowerCase()] = idx;
});

// Process matches
let matched = 0;
let alreadyHadPhoto = 0;
let newPhotos = 0;
let copiedFiles = 0;
let missingFiles = 0;
const unmatchedSupabase = [];

for (const row of supabaseRows) {
  if (!row.image_url || !row.scientific_name) continue;

  const sciName = row.scientific_name.toLowerCase().trim();
  const masterIdx = masterByName[sciName];

  if (masterIdx === undefined) {
    unmatchedSupabase.push({ name: row.scientific_name, common: row.common_name, category: row.category });
    continue;
  }

  matched++;
  const species = masterData[masterIdx];

  // If already has a photo, skip
  if (species.masterPhotoUrl) {
    alreadyHadPhoto++;
    continue;
  }

  // Extract filename from Supabase URL
  const urlParts = row.image_url.split("/");
  const filename = urlParts[urlParts.length - 1];
  const sourceFile = path.join(migrationDir, filename);

  // Generate local filename from scientific name
  const localFilename = species.scientificName.toLowerCase().replace(/\s+/g, "-") + ".png";
  const destFile = path.join(imagesDir, localFilename);

  if (fs.existsSync(sourceFile)) {
    // Copy file to public/species-images/
    fs.copyFileSync(sourceFile, destFile);
    copiedFiles++;

    // Update masterPhotoUrl
    species.masterPhotoUrl = `/species-images/${localFilename}`;
    newPhotos++;
    console.log(`  ✅ ${species.commonName} (${species.scientificName}) → ${localFilename}`);
  } else {
    missingFiles++;
    console.log(`  ⚠️  File not found: ${filename} (for ${species.scientificName})`);
  }
}

// Save updated fishbase_master.json
fs.writeFileSync(masterPath, JSON.stringify(masterData, null, 2));

console.log(`\n=== Results ===`);
console.log(`  Matched to fishbase_master: ${matched}`);
console.log(`  Already had photo: ${alreadyHadPhoto}`);
console.log(`  New photos added: ${newPhotos}`);
console.log(`  Files copied: ${copiedFiles}`);
console.log(`  Missing files: ${missingFiles}`);
console.log(`  Unmatched (not in fishbase_master): ${unmatchedSupabase.length}`);

if (unmatchedSupabase.length > 0) {
  console.log(`\n  Unmatched species from Supabase (not in current catalog):`);
  unmatchedSupabase.forEach(u => console.log(`    - ${u.common} (${u.name}) [${u.category}]`));
}

console.log(`\n✅ fishbase_master.json updated with ${newPhotos} new photo paths.`);
