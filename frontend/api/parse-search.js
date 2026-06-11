// Vercel serverless function: frontend/api/parse-search.js
// Poseidon Natural Language Search — Converts plain-English queries into structured filters.
//
// Examples:
// "beginner fish that like warm water" → { difficulty: "Easy", tempMin: 26 }
// "corydoras under 10cm" → { searchTerm: "corydoras", maxSize: 10 }
// "peaceful community fish for a 20 gallon tank" → { temperament: "peaceful", minVolume: 20 }
// "What cichlids can live in pH 7.5?" → { searchTerm: "cichlid", phMin: 7.0, phMax: 8.0 }

import { buildSpeciesContext, findSpeciesInQuery } from './_lib/speciesIndex.js';
import { vertexGenerateContent, isVertexConfigured } from './_lib/vertexClient.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { query, tankContext } = req.body || {};

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing query field' });
  }

  // If Vertex AI isn't configured, attempt basic local parsing
  if (!isVertexConfigured()) {
    const localResult = parseQueryLocally(query);
    return res.status(200).json(localResult);
  }

  try {
    // Check if the query directly mentions species in our catalog
    const mentionedSpecies = findSpeciesInQuery(query, 3);

    const systemPrompt = `You are a search query parser for Aquacellum, a freshwater aquarium species database with 326 species.

Parse the user's natural language search query into structured filters. Return ONLY valid JSON matching this schema:

{
  "searchTerm": "text to fuzzy-match against species names (common or scientific)",
  "filters": {
    "difficulty": "Easy | Medium | Difficult | Expert | null",
    "family": "Cichlidae | Poeciliidae | Loricariidae | etc. | null",
    "tempMin": null or number (°C),
    "tempMax": null or number (°C),
    "phMin": null or number,
    "phMax": null or number,
    "maxSize": null or number (cm),
    "minVolume": null or number (gallons),
    "temperament": "peaceful | semi-aggressive | aggressive | null",
    "diet": "Omnivore | Herbivore | Carnivore | null"
  },
  "explanation": "Brief 1-sentence explanation of how you interpreted the query",
  "suggestedSpecies": ["array of species common names that match, if obvious from the query"]
}

Rules:
- If the query mentions "beginner" or "easy", set difficulty to "Easy"
- If the query mentions "warm water", set tempMin to 26
- If the query mentions "cold water", set tempMax to 22
- If the query mentions a tank size in gallons, set minVolume
- If the query mentions a specific pH value, set phMin and phMax to a reasonable range around it
- If no specific filter applies, leave it as null
- searchTerm should capture the core species name or family being searched for
- suggestedSpecies should list 1-5 species names you think match (from general aquarium knowledge)`;

    const userPrompt = `Parse this search query: "${query}"${tankContext ? `\n\nUser's tank: ${tankContext.volume}gal, ${tankContext.temp}°C, pH ${tankContext.ph}` : ''}${mentionedSpecies.length > 0 ? `\n\nSpecies detected in catalog: ${mentionedSpecies.map(s => `${s.commonName} (${s.scientificName})`).join(', ')}` : ''}`;

    const geminiResponse = await vertexGenerateContent('gemini-2.5-flash-lite', {
        contents: [
          { role: "user", parts: [{ text: systemPrompt }] },
          { role: "model", parts: [{ text: "Understood. I will parse natural language aquarium search queries into structured filter JSON." }] },
          { role: "user", parts: [{ text: userPrompt }] }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              searchTerm: { type: "string" },
              filters: {
                type: "object",
                properties: {
                  difficulty: { type: "string" },
                  family: { type: "string" },
                  tempMin: { type: "number" },
                  tempMax: { type: "number" },
                  phMin: { type: "number" },
                  phMax: { type: "number" },
                  maxSize: { type: "number" },
                  minVolume: { type: "number" },
                  temperament: { type: "string" },
                  diet: { type: "string" }
                }
              },
              explanation: { type: "string" },
              suggestedSpecies: { type: "array", items: { type: "string" } }
            },
            required: ["searchTerm", "filters", "explanation"]
          },
          temperature: 0.2,
          maxOutputTokens: 512,
        }
    });

    if (!geminiResponse.ok) {
      console.error('[Parse Search] Gemini error:', geminiResponse.status);
      const localResult = parseQueryLocally(query);
      return res.status(200).json(localResult);
    }

    const result = await geminiResponse.json();
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      const localResult = parseQueryLocally(query);
      return res.status(200).json(localResult);
    }

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const localResult = parseQueryLocally(query);
      return res.status(200).json(localResult);
    }

    // Enrich with catalog matches
    if (mentionedSpecies.length > 0) {
      parsed.catalogMatches = mentionedSpecies.map(s => ({
        specCode: s.specCode,
        commonName: s.commonName,
        scientificName: s.scientificName,
      }));
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('[Parse Search] Error:', err);
    const localResult = parseQueryLocally(query);
    return res.status(200).json(localResult);
  }
}

/**
 * Basic local parser as fallback when Gemini is unavailable.
 * Handles common patterns without AI.
 */
function parseQueryLocally(query) {
  const q = query.toLowerCase();
  const filters = {};
  let searchTerm = query;

  // Difficulty
  if (q.includes('beginner') || q.includes('easy')) filters.difficulty = 'Easy';
  else if (q.includes('intermediate') || q.includes('medium')) filters.difficulty = 'Medium';
  else if (q.includes('advanced') || q.includes('difficult')) filters.difficulty = 'Difficult';
  else if (q.includes('expert')) filters.difficulty = 'Expert';

  // Temperature
  if (q.includes('warm') || q.includes('tropical')) filters.tempMin = 26;
  if (q.includes('cold') || q.includes('cool')) filters.tempMax = 22;

  // Tank size
  const gallonMatch = q.match(/(\d+)\s*gal/i);
  if (gallonMatch) filters.minVolume = parseInt(gallonMatch[1], 10);

  // pH
  const phMatch = q.match(/ph\s*(\d+\.?\d*)/i);
  if (phMatch) {
    const ph = parseFloat(phMatch[1]);
    filters.phMin = Math.max(4, ph - 0.5);
    filters.phMax = Math.min(10, ph + 0.5);
  }

  // Size
  const sizeMatch = q.match(/under\s*(\d+)\s*cm/i) || q.match(/less than\s*(\d+)\s*cm/i);
  if (sizeMatch) filters.maxSize = parseInt(sizeMatch[1], 10);

  // Temperament
  if (q.includes('peaceful') || q.includes('community')) filters.temperament = 'peaceful';
  if (q.includes('aggressive')) filters.temperament = 'aggressive';

  // Strip filter keywords from search term
  searchTerm = query
    .replace(/\b(beginner|easy|intermediate|medium|advanced|difficult|expert)\b/gi, '')
    .replace(/\b(warm|cold|cool|tropical)\b/gi, '')
    .replace(/\b(peaceful|community|aggressive)\b/gi, '')
    .replace(/\d+\s*gal(lons?)?/gi, '')
    .replace(/ph\s*\d+\.?\d*/gi, '')
    .replace(/under\s*\d+\s*cm/gi, '')
    .replace(/less than\s*\d+\s*cm/gi, '')
    .replace(/\b(fish|for|that|can|live|in|a|my|tank|water)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    searchTerm,
    filters,
    explanation: 'Parsed locally (offline mode)',
    suggestedSpecies: [],
  };
}
