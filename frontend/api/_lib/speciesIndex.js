/**
 * Species Index — Server-side species catalog loader and fuzzy search for Poseidon RAG.
 * 
 * Loads fishbase_master.json once at cold-start and provides fast name matching
 * for species mentioned in user queries. This grounds Poseidon's responses in
 * the actual curated catalog data rather than relying on general model knowledge.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

let speciesCatalog = null;
let commonNameIndex = null;
let scientificNameIndex = null;

/**
 * Load the species catalog from the public directory.
 * Cached in module scope — only loads once per cold start.
 */
function loadCatalog() {
  if (speciesCatalog) return speciesCatalog;

  try {
    // In Vercel serverless functions deployed from frontend/api/,
    // the public folder is at ../public relative to api/
    // process.cwd() in Vercel points to the function's root
    const possiblePaths = [
      join(process.cwd(), 'public', 'fishbase_master.json'),
      join(process.cwd(), '..', 'public', 'fishbase_master.json'),
      join(process.cwd(), 'frontend', 'public', 'fishbase_master.json'),
    ];

    let raw = null;
    for (const filePath of possiblePaths) {
      try {
        raw = readFileSync(filePath, 'utf-8');
        break;
      } catch {
        continue;
      }
    }

    if (!raw) {
      throw new Error('fishbase_master.json not found in any expected path');
    }

    speciesCatalog = JSON.parse(raw);

    // Build lookup indices for fast name matching
    commonNameIndex = new Map();
    scientificNameIndex = new Map();

    for (const species of speciesCatalog) {
      if (species.commonName) {
        commonNameIndex.set(species.commonName.toLowerCase(), species);
      }
      if (species.scientificName) {
        scientificNameIndex.set(species.scientificName.toLowerCase(), species);
      }
    }

    console.log(`[Species Index] Loaded ${speciesCatalog.length} species from catalog`);
    return speciesCatalog;
  } catch (err) {
    console.error('[Species Index] Failed to load fishbase_master.json:', err.message);
    speciesCatalog = [];
    commonNameIndex = new Map();
    scientificNameIndex = new Map();
    return speciesCatalog;
  }
}

/**
 * Extract species mentioned in a user's message via fuzzy substring matching.
 * Returns up to `maxResults` matching species entries from the catalog.
 */
export function findSpeciesInQuery(query, maxResults = 5) {
  loadCatalog();
  if (!speciesCatalog || speciesCatalog.length === 0) return [];

  const queryLower = query.toLowerCase();
  const matches = new Map(); // Use Map to deduplicate by specCode

  // 1. Exact common name match
  for (const [name, species] of commonNameIndex) {
    if (queryLower.includes(name)) {
      matches.set(species.specCode, { species, score: 1.0 });
    }
  }

  // 2. Exact scientific name match
  for (const [name, species] of scientificNameIndex) {
    if (queryLower.includes(name)) {
      matches.set(species.specCode, { species, score: 1.0 });
    }
  }

  // 3. Partial / fuzzy match — check if any word in the query is a substring of a species name
  // This catches partial mentions like "neon" matching "Neon Tetra" or "corydoras" matching genus
  if (matches.size < maxResults) {
    const queryWords = queryLower
      .split(/\s+/)
      .filter(w => w.length >= 4); // Only match on words with 4+ chars to avoid false positives

    for (const species of speciesCatalog) {
      if (matches.has(species.specCode)) continue;

      const commonLower = (species.commonName || '').toLowerCase();
      const sciLower = (species.scientificName || '').toLowerCase();
      const genusLower = (species.genus || '').toLowerCase();

      for (const word of queryWords) {
        if (
          commonLower.includes(word) ||
          sciLower.includes(word) ||
          genusLower === word
        ) {
          matches.set(species.specCode, { species, score: 0.7 });
          break;
        }
      }

      if (matches.size >= maxResults * 2) break; // Collect extra for sorting
    }
  }

  // Sort by score (exact matches first) and limit
  const sorted = Array.from(matches.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(m => m.species);

  return sorted;
}

/**
 * Get species by specCode (direct lookup).
 */
export function getSpeciesByCode(specCode) {
  loadCatalog();
  return speciesCatalog?.find(s => s.specCode === specCode) || null;
}

/**
 * Get species by IDs (batch lookup for tank inhabitants).
 */
export function getSpeciesByCodes(specCodes) {
  loadCatalog();
  if (!speciesCatalog) return [];
  return specCodes
    .map(code => speciesCatalog.find(s => s.specCode === code))
    .filter(Boolean);
}

/**
 * Format species data into a concise context string for the AI prompt.
 * Includes the fields most useful for Poseidon's responses.
 */
export function formatSpeciesForContext(species, mode = 'casual') {
  if (!species) return '';

  const lines = [
    `### ${species.commonName} (${species.scientificName})`,
    `- specCode: ${species.specCode} | Family: ${species.family || 'N/A'} | Max size: ${species.maxLengthCm || '?'}cm`,
    `- Temperature: ${species.tankMetrics?.tempRangeCelsius?.join('–') || '?'}°C | pH: ${species.tankMetrics?.phRange?.join('–') || '?'} | Difficulty: ${species.tankMetrics?.difficulty || '?'}`,
  ];

  if (species.tankMetrics?.minVolumeGallons) {
    lines.push(`- Minimum tank: ${species.tankMetrics.minVolumeGallons} gallons`);
  }

  if (species.ecology) {
    if (species.ecology.socialBehavior && species.ecology.socialBehavior !== 'Information arriving soon') {
      lines.push(`- Social: ${species.ecology.socialBehavior}`);
    }
    if (species.ecology.biotope && species.ecology.biotope !== 'Generic Biotope Details') {
      lines.push(`- Biotope: ${species.ecology.biotope}`);
    }
  }

  if (species.diet) {
    if (species.diet.trophicLevel) {
      lines.push(`- Diet: ${species.diet.trophicLevel} — ${species.diet.fooditems || ''}`);
    }
  }

  if (species.reproduction && species.reproduction.spawningTrait && species.reproduction.spawningTrait !== 'Information arriving soon') {
    lines.push(`- Breeding: ${species.reproduction.spawningTrait}`);
  }

  // Include personality text matching the mode
  if (species.personality) {
    const flavorKey = mode === 'pro' ? 'pro' : 'casual';
    if (species.personality.flavorText?.[flavorKey]) {
      lines.push(`- Bio: ${species.personality.flavorText[flavorKey]}`);
    }
  }

  return lines.join('\n');
}

/**
 * Find relevant species and format them for prompt injection.
 * This is the main RAG function called by the Poseidon gateway.
 */
export function buildSpeciesContext(query, sessionData = {}, mode = 'casual', maxSpecies = 8) {
  const contextSpecies = new Map(); // Deduplicate by specCode

  // 1. Species explicitly mentioned in the query
  const queryMatches = findSpeciesInQuery(query, 5);
  for (const sp of queryMatches) {
    contextSpecies.set(sp.specCode, sp);
  }

  // 2. Species from the user's active tank (if session data provides them)
  if (sessionData.tankSpeciesCodes && Array.isArray(sessionData.tankSpeciesCodes)) {
    const tankSpecies = getSpeciesByCodes(sessionData.tankSpeciesCodes);
    for (const sp of tankSpecies) {
      if (contextSpecies.size < maxSpecies) {
        contextSpecies.set(sp.specCode, sp);
      }
    }
  }

  // 3. Species from session context (already resolved by the frontend)
  if (sessionData.speciesContext && Array.isArray(sessionData.speciesContext)) {
    for (const sp of sessionData.speciesContext) {
      if (sp.specCode && contextSpecies.size < maxSpecies) {
        // Try to get the full catalog entry for richer data
        const full = getSpeciesByCode(sp.specCode) || sp;
        contextSpecies.set(sp.specCode, full);
      }
    }
  }

  if (contextSpecies.size === 0) return '';

  const header = '## SPECIES DATABASE (from Aquacellum curated catalog — use these values as ground truth)';
  const entries = Array.from(contextSpecies.values())
    .slice(0, maxSpecies)
    .map(sp => formatSpeciesForContext(sp, mode))
    .join('\n\n');

  return `${header}\n\n${entries}`;
}
