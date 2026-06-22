/**
 * poseidonDeepLinks.js — Parses Poseidon response text and detects species names
 * or navigation intents, converting them into actionable deep-link tokens.
 *
 * This keeps Poseidon from competing with the UI: instead of dumping all data
 * inline, responses link users to the relevant species/marketplace/tab page.
 */

// Common freshwater species names (genus or common name) that we want to detect
// and turn into clickable navigation links. This is intentionally broad —
// false positives are low-cost (just a highlighted word).
const SPECIES_PATTERNS = [
  // Common names (case-insensitive matching)
  "clownfish", "betta", "guppy", "guppies", "neon tetra", "cardinal tetra",
  "angelfish", "discus", "oscar", "pleco", "corydoras", "cory catfish",
  "molly", "mollies", "platy", "platies", "swordtail", "endler",
  "rasbora", "danio", "zebra danio", "cherry barb", "tiger barb",
  "gouramis?", "dwarf gourami", "pearl gourami", "honey gourami",
  "cichlid", "african cichlid", "ram cichlid", "apistogramma",
  "loach", "kuhli loach", "clown loach", "hillstream loach",
  "rainbowfish", "killifish", "shrimp", "cherry shrimp", "amano shrimp",
  "snail", "mystery snail", "nerite snail",
  "bristlenose", "otocinclus", "siamese algae eater",
  "harlequin rasbora", "ember tetra", "rummy nose tetra",
  "german blue ram", "electric blue ram", "bolivian ram",
  "pea puffer", "figure eight puffer",
];

// Build a single regex that matches any of the species patterns (word boundaries)
const speciesRegex = new RegExp(
  `\\b(${SPECIES_PATTERNS.join("|")})\\b`,
  "gi"
);

// Navigation intent patterns — phrases that suggest the user should go somewhere
const NAV_PATTERNS = [
  { pattern: /\b(?:check|view|see|visit|go to|open)\s+(?:the\s+)?marketplace\b/gi, tab: "directory", label: "Open Marketplace" },
  { pattern: /\b(?:check|view|see|visit|go to|open)\s+(?:your\s+)?tanks?\b/gi, tab: "tanks", label: "View Tanks" },
  { pattern: /\b(?:check|view|see|visit|go to|open)\s+(?:the\s+)?breed(?:er)?\s*(?:gallery|tools)?\b/gi, tab: "breeder", label: "Breeder Tools" },
  { pattern: /\b(?:check|view|see|visit|go to|open)\s+(?:the\s+)?reef\b/gi, tab: "reef", label: "The Reef" },
  { pattern: /\b(?:check|view|see|visit|go to|open)\s+(?:the\s+)?gallery\b/gi, tab: "gallery", label: "Gallery" },
];

/**
 * Parse a Poseidon message text and return an array of segments:
 * - { type: "text", content: "..." } — plain text
 * - { type: "species", content: "Neon Tetra", query: "neon tetra" } — species link
 * - { type: "nav", content: "Open Marketplace", tab: "directory" } — tab navigation link
 *
 * @param {string} text — Raw Poseidon message text
 * @returns {Array} — Array of parsed segments
 */
export function parsePoseidonMessage(text) {
  if (!text || typeof text !== "string") return [{ type: "text", content: text || "" }];

  // First pass: detect navigation intents and mark their positions
  const navMatches = [];
  for (const { pattern, tab, label } of NAV_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      navMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "nav",
        content: label,
        tab,
        original: match[0],
      });
    }
  }

  // Second pass: detect species names
  const speciesMatches = [];
  speciesRegex.lastIndex = 0;
  let match;
  while ((match = speciesRegex.exec(text)) !== null) {
    // Skip if overlapping with a nav match
    const overlaps = navMatches.some(
      n => match.index >= n.start && match.index < n.end
    );
    if (!overlaps) {
      speciesMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "species",
        content: match[0],
        query: match[0].toLowerCase(),
      });
    }
  }

  // Merge and sort all matches by position
  const allMatches = [...navMatches, ...speciesMatches].sort((a, b) => a.start - b.start);

  // If no matches, return plain text
  if (allMatches.length === 0) {
    return [{ type: "text", content: text }];
  }

  // Build segments
  const segments = [];
  let cursor = 0;

  for (const m of allMatches) {
    // Skip if this match starts before our cursor (overlapping with previous)
    if (m.start < cursor) continue;

    // Add plain text before this match
    if (m.start > cursor) {
      segments.push({ type: "text", content: text.slice(cursor, m.start) });
    }

    if (m.type === "nav") {
      segments.push({ type: "nav", content: m.original, tab: m.tab, label: m.content });
    } else {
      segments.push({ type: "species", content: m.content, query: m.query });
    }

    cursor = m.end;
  }

  // Add remaining text
  if (cursor < text.length) {
    segments.push({ type: "text", content: text.slice(cursor) });
  }

  return segments;
}
