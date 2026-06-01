/**
 * add-plants-inverts.js
 * 
 * Adds plant and invertebrate entries from species_rows.csv to fishbase_master.json,
 * copies their images from migration_assets/, and sets the category/type field.
 * 
 * Usage: node scripts/add-plants-inverts.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// Simple CSV parser that handles quoted fields
function parseCSV(text) {
  const lines = text.split("\n");
  const headers = lines[0].split(",").map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const row = {};
    let col = 0;
    let inQuotes = false;
    let field = "";

    for (let j = 0; j <= line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if ((ch === "," || j === line.length) && !inQuotes) {
        row[headers[col]] = field.trim();
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

// Paths
const csvPath = path.join(ROOT, "species_rows.csv");
const masterPath = path.join(ROOT, "frontend", "public", "fishbase_master.json");
const migrationDir = path.join(ROOT, "migration_assets");
const imagesDir = path.join(ROOT, "frontend", "public", "species-images");

console.log("=== Adding Plants & Invertebrates to fishbase_master.json ===\n");

// Parse CSV
const csvText = fs.readFileSync(csvPath, "utf8");
const supabaseRows = parseCSV(csvText);

// Load master
const masterData = JSON.parse(fs.readFileSync(masterPath, "utf8"));
const existingNames = new Set(masterData.map(s => s.scientificName.toLowerCase()));

// Filter to plants and invertebrates that aren't already in master
const plantsAndInverts = supabaseRows.filter(r => {
  const cat = (r.category || "").toLowerCase();
  return (cat === "plant" || cat === "invertebrate") && 
         r.scientific_name && 
         !existingNames.has(r.scientific_name.toLowerCase().trim());
});

console.log(`Found ${plantsAndInverts.length} plants/invertebrates to add\n`);

// Also add fish that are unmatched but have valid scientific names (not "spp." generics)
const unmatchedFish = supabaseRows.filter(r => {
  const cat = (r.category || "").toLowerCase();
  const name = (r.scientific_name || "").toLowerCase().trim();
  return cat === "fish" && 
         !existingNames.has(name) && 
         !name.includes("spp.") && 
         !name.includes("(") &&
         name.split(" ").length >= 2;
});

console.log(`Found ${unmatchedFish.length} additional fish to add\n`);

const toAdd = [...plantsAndInverts, ...unmatchedFish];

// Use specCode starting at 90001 for plants, 80001 for invertebrates
// This keeps them clearly separated and above the fish range
let plantCode = 90001;
let invertCode = 80001;
let fishCode = 70001;

let added = 0;
let imagesCopied = 0;

for (const row of toAdd) {
  const category = (row.category || "fish").toLowerCase();
  let specCode;
  if (category === "plant") specCode = plantCode++;
  else if (category === "invertebrate") specCode = invertCode++;
  else specCode = fishCode++;

  // Parse numeric fields
  const tempMin = parseFloat(row.temp_min_c) || 20;
  const tempMax = parseFloat(row.temp_max_c) || 28;
  const phMin = parseFloat(row.ph_min) || 6.5;
  const phMax = parseFloat(row.ph_max) || 7.5;
  const maxSize = parseFloat(row.max_size_cm) || 0;
  const minTankGallons = parseInt(row.min_tank_gallons) || 10;

  // Map care difficulty
  const difficultyMap = { "beginner": "Beginner", "easy": "Beginner", "intermediate": "Intermediate", "advanced": "Advanced", "expert": "Expert" };
  const difficulty = difficultyMap[(row.care_difficulty || "").toLowerCase()] || "Intermediate";

  // Handle image
  let masterPhotoUrl = "";
  if (row.image_url) {
    const urlParts = row.image_url.split("/");
    const filename = urlParts[urlParts.length - 1];
    const sourceFile = path.join(migrationDir, filename);
    const localFilename = row.scientific_name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + ".png";
    const destFile = path.join(imagesDir, localFilename);

    if (fs.existsSync(sourceFile)) {
      fs.copyFileSync(sourceFile, destFile);
      masterPhotoUrl = `/species-images/${localFilename}`;
      imagesCopied++;
    }
  }

  // Build the entry
  const entry = {
    specCode: specCode,
    scientificName: row.scientific_name.trim(),
    genus: row.scientific_name.trim().split(" ")[0],
    species: row.scientific_name.trim().split(" ").slice(1).join(" "),
    commonName: row.common_name.trim(),
    family: "",
    maxLengthCm: maxSize,
    masterPhotoUrl: masterPhotoUrl,
    type: category,  // "plant", "invertebrate", or "fish"
    tankMetrics: {
      minVolumeGallons: minTankGallons,
      tempRangeCelsius: [tempMin, tempMax],
      phRange: [phMin, phMax],
      difficulty: difficulty
    },
    ecology: {
      comments: row.notes || "",
      phMin: phMin,
      phMax: phMax
    }
  };

  // Add diet for non-plants
  if (category !== "plant" && row.diet) {
    entry.diet = { trophicLevel: row.diet, fooditems: "", feedingPlaybook: "" };
  }

  masterData.push(entry);
  added++;

  const emoji = category === "plant" ? "🌿" : category === "invertebrate" ? "🦐" : "🐟";
  console.log(`  ${emoji} ${row.common_name} (${row.scientific_name}) [${category}] ${masterPhotoUrl ? "📷" : "⬜"}`);
}

// Save
fs.writeFileSync(masterPath, JSON.stringify(masterData, null, 2));

console.log(`\n=== Results ===`);
console.log(`  Added: ${added} entries`);
console.log(`  Images copied: ${imagesCopied}`);
console.log(`  Total species in fishbase_master.json: ${masterData.length}`);
console.log(`\n✅ Done! fishbase_master.json now includes plants and invertebrates.`);
