/**
 * useBiomeClassifier — Maps each species to one of the 6 GenerativeReef biomes.
 *
 * Biomes:
 *   amazon_blackwater — catfish, corydoras, tetras preferring soft/acidic water, loaches
 *   dutch_planted     — community fish: livebearers, rasboras, gouramis, small tetras
 *   asian_stream      — danios, loaches, barbs, hillstream species
 *   rift_lake         — African cichlids, high-pH species, large territorial fish
 *   iwagumi           — nano/small peaceful species: small rasboras, shrimp-safe tetras, bettas
 *   crystal_spring    — rainbowfish, killifish, livebearers from clear springs
 *
 * Classification uses a scoring system based on:
 *   - Family taxonomy
 *   - ecology.biotope keywords
 *   - pH preference
 *   - Temperature preference
 *   - Body size
 *   - Social behavior
 *
 * Each species gets assigned to exactly one biome (highest score wins).
 * Ties broken by deterministic hash to ensure even distribution.
 */
import { useMemo } from "react";

// --- Biome scoring rules ---

const FAMILY_BIOME_MAP = {
  // amazon_blackwater: catfish, corydoras, larger tetras, loricariids
  loricariidae: "amazon_blackwater",
  callichthyidae: "amazon_blackwater",
  doradidae: "amazon_blackwater",
  auchenipteridae: "amazon_blackwater",
  pimelodidae: "amazon_blackwater",

  // rift_lake: African cichlids
  cichlidae: "rift_lake",

  // asian_stream: cyprinids that are stream-dwellers
  balitoridae: "asian_stream",
  gastromyzontidae: "asian_stream",
  nemacheilidae: "asian_stream",

  // dutch_planted: community livebearers, gouramis
  poeciliidae: "dutch_planted",
  osphronemidae: "dutch_planted",
  helostomatidae: "dutch_planted",

  // crystal_spring: rainbowfish, killifish
  melanotaeniidae: "crystal_spring",
  pseudomugilidae: "crystal_spring",
  aplocheilidae: "crystal_spring",
  nothobranchiidae: "crystal_spring",
  fundulidae: "crystal_spring",
  rivulidae: "crystal_spring",
};

// Biotope keyword → biome affinity (keyword, biome, score)
const BIOTOPE_RULES = [
  // amazon_blackwater
  ["blackwater", "amazon_blackwater", 15],
  ["tannin", "amazon_blackwater", 12],
  ["leaf litter", "amazon_blackwater", 10],
  ["amazon", "amazon_blackwater", 8],
  ["driftwood", "amazon_blackwater", 8],
  ["tributary", "amazon_blackwater", 6],
  ["south america", "amazon_blackwater", 5],

  // dutch_planted
  ["plant", "dutch_planted", 8],
  ["vegetation", "dutch_planted", 10],
  ["densely planted", "dutch_planted", 12],
  ["aquatic plants", "dutch_planted", 10],

  // asian_stream
  ["stream", "asian_stream", 8],
  ["fast-flowing", "asian_stream", 10],
  ["hillstream", "asian_stream", 12],
  ["current", "asian_stream", 6],
  ["asia", "asian_stream", 5],
  ["pebble", "asian_stream", 8],
  ["boulder", "asian_stream", 6],

  // rift_lake
  ["rift", "rift_lake", 15],
  ["lake malawi", "rift_lake", 15],
  ["lake tanganyika", "rift_lake", 15],
  ["lake victoria", "rift_lake", 12],
  ["rocky", "rift_lake", 6],
  ["cave", "rift_lake", 6],
  ["africa", "rift_lake", 5],

  // iwagumi (calm, minimal)
  ["still water", "iwagumi", 6],
  ["calm", "iwagumi", 5],
  ["shallow", "iwagumi", 4],
  ["pool", "iwagumi", 4],

  // crystal_spring
  ["spring", "crystal_spring", 10],
  ["clear", "crystal_spring", 6],
  ["australia", "crystal_spring", 8],
  ["new guinea", "crystal_spring", 8],
  ["creek", "crystal_spring", 5],
];

const ALL_BIOMES = [
  "amazon_blackwater",
  "dutch_planted",
  "asian_stream",
  "rift_lake",
  "iwagumi",
  "crystal_spring",
];

/**
 * Deterministic hash for tie-breaking.
 */
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Score a species for each biome. Returns the biome with highest score.
 */
function classifySpecies(species) {
  const scores = {};
  for (const b of ALL_BIOMES) scores[b] = 0;

  const family = (species.family || "").toLowerCase();
  const biotope = (species.ecology?.biotope || "").toLowerCase();
  const comments = (species.ecology?.comments || "").toLowerCase();
  const combined = biotope + " " + comments;
  const phMin = species.ecology?.phMin ?? species.tankMetrics?.phRange?.[0] ?? 7;
  const phMax = species.ecology?.phMax ?? species.tankMetrics?.phRange?.[1] ?? 7.5;
  const phMid = (phMin + phMax) / 2;
  const tempRange = species.tankMetrics?.tempRangeCelsius || [24, 28];
  const tempMid = (tempRange[0] + tempRange[1]) / 2;
  const maxLen = species.maxLengthCm || 8;
  const social = (species.ecology?.socialBehavior || "").toLowerCase();

  // 1. Family-based scoring (strong signal)
  if (FAMILY_BIOME_MAP[family]) {
    scores[FAMILY_BIOME_MAP[family]] += 12;
  }

  // 2. Biotope keyword scoring
  for (const [keyword, biome, pts] of BIOTOPE_RULES) {
    if (combined.includes(keyword)) {
      scores[biome] += pts;
    }
  }

  // 3. pH-based scoring
  if (phMid <= 6.5) {
    // Acidic → blackwater
    scores.amazon_blackwater += 6;
  } else if (phMid >= 7.8) {
    // Alkaline → rift lake
    scores.rift_lake += 6;
  } else if (phMid >= 6.8 && phMid <= 7.4) {
    // Neutral → planted or stream
    scores.dutch_planted += 3;
    scores.asian_stream += 3;
    scores.crystal_spring += 2;
  }

  // 4. Temperature-based
  if (tempMid >= 27) {
    // Warm tropical → blackwater or planted
    scores.amazon_blackwater += 3;
    scores.dutch_planted += 2;
  } else if (tempMid <= 23) {
    // Cooler → stream or crystal spring
    scores.asian_stream += 4;
    scores.crystal_spring += 3;
  }

  // 5. Size-based: tiny fish → iwagumi
  if (maxLen <= 4) {
    scores.iwagumi += 8;
  } else if (maxLen <= 6) {
    scores.iwagumi += 4;
    scores.dutch_planted += 2;
  } else if (maxLen >= 15) {
    // Larger fish → rift lake or blackwater
    scores.rift_lake += 3;
    scores.amazon_blackwater += 3;
  }

  // 6. Social behavior
  if (social.includes("school") || social.includes("group")) {
    scores.dutch_planted += 2;
    scores.asian_stream += 2;
  }
  if (social.includes("territorial") || social.includes("aggressive")) {
    scores.rift_lake += 3;
  }
  if (social.includes("peaceful") || social.includes("timid")) {
    scores.iwagumi += 3;
    scores.dutch_planted += 2;
  }

  // 7. Cyprinidae split: barbs/danios → asian_stream, rasboras (small) → iwagumi or planted
  if (family === "cyprinidae") {
    const genus = (species.genus || "").toLowerCase();
    if (genus.includes("danio") || genus.includes("devario") || genus.includes("puntius") || genus.includes("barbus")) {
      scores.asian_stream += 8;
    } else if (genus.includes("rasbora") || genus.includes("boraras") || genus.includes("trigonostigma")) {
      if (maxLen <= 3.5) {
        scores.iwagumi += 8;
      } else {
        scores.dutch_planted += 6;
      }
    } else {
      scores.asian_stream += 4;
    }
  }

  // 8. Characidae split: larger tetras → blackwater, small tetras → planted
  if (family === "characidae") {
    if (maxLen >= 6) {
      scores.amazon_blackwater += 6;
    } else {
      scores.dutch_planted += 5;
      scores.amazon_blackwater += 3;
    }
  }

  // 9. Betta → iwagumi (calm, still water)
  const genus = (species.genus || "").toLowerCase();
  if (genus === "betta") {
    scores.iwagumi += 10;
  }

  // 10. Central American cichlids split from African
  if (family === "cichlidae") {
    if (combined.includes("africa") || combined.includes("rift") || combined.includes("malawi") || combined.includes("tanganyika") || combined.includes("victoria")) {
      scores.rift_lake += 8;
    } else if (combined.includes("central america") || combined.includes("south america") || combined.includes("amazon")) {
      scores.amazon_blackwater += 6;
      scores.rift_lake -= 4; // de-prioritize rift for New World cichlids
    } else {
      // Default cichlids stay rift unless there's a South American signal
      scores.rift_lake += 4;
    }
  }

  // Find winner
  let best = "dutch_planted"; // default fallback
  let bestScore = -1;
  for (const b of ALL_BIOMES) {
    if (scores[b] > bestScore) {
      bestScore = scores[b];
      best = b;
    }
  }

  // Tie-break with deterministic hash to distribute evenly
  const tied = ALL_BIOMES.filter(b => scores[b] === bestScore);
  if (tied.length > 1) {
    const hash = hashStr(species.scientificName || species.commonName || "");
    best = tied[hash % tied.length];
  }

  return best;
}

/**
 * Hook: classifies all species into biomes.
 * Returns a map of biome → species[] and a lookup of specCode → biome.
 */
export function useBiomeClassifier(speciesData) {
  return useMemo(() => {
    const biomeMap = {};
    const speciesLookup = {};

    for (const b of ALL_BIOMES) biomeMap[b] = [];

    for (const sp of speciesData) {
      const biome = classifySpecies(sp);
      biomeMap[biome].push(sp);
      speciesLookup[sp.specCode || sp.scientificName] = biome;
    }

    return { biomeMap, speciesLookup, ALL_BIOMES };
  }, [speciesData]);
}

/**
 * Get species for a specific biome, with optional cross-biome spillover
 * for biomes with very few species (ensures minimum population).
 */
export function getSpeciesForBiome(biomeMap, biome, minCount = 8) {
  const primary = biomeMap[biome] || [];
  if (primary.length >= minCount) return primary;

  // If a biome is underpopulated, borrow from adjacent/similar biomes
  const ADJACENT = {
    amazon_blackwater: ["dutch_planted", "asian_stream"],
    dutch_planted: ["amazon_blackwater", "iwagumi"],
    asian_stream: ["dutch_planted", "crystal_spring"],
    rift_lake: ["crystal_spring", "amazon_blackwater"],
    iwagumi: ["dutch_planted", "asian_stream"],
    crystal_spring: ["asian_stream", "rift_lake"],
  };

  const result = [...primary];
  const neighbors = ADJACENT[biome] || [];

  for (const adj of neighbors) {
    if (result.length >= minCount) break;
    const pool = biomeMap[adj] || [];
    // Take up to (minCount - current) from neighbor, preferring smaller fish
    const needed = minCount - result.length;
    const sorted = [...pool].sort((a, b) => (a.maxLengthCm || 8) - (b.maxLengthCm || 8));
    result.push(...sorted.slice(0, needed));
  }

  return result;
}

// Export for direct use without hooks
export { classifySpecies, ALL_BIOMES };
