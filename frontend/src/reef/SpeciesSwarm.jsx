import React, { useMemo } from "react";
import { FishSchool } from "./FishSchool";

/**
 * SpeciesSwarm — Takes the full species dataset and renders each species
 * as a swimming school placed in the correct biome zone.
 *
 * Biome classification is derived from ecology data:
 * - Rocky/Cave zone: cichlids, loaches with "rock" or "cave" in biotope
 * - Planted zone: tetras, rasboras, livebearers
 * - Bottom/Driftwood zone: plecos, corydoras
 * - Open water zone: danios, barbs, and everything else
 */

const BIOME_ZONES = {
  rocky: { center: [-12, 0, -8], radius: 8 },
  planted: { center: [10, 1, -5], radius: 8 },
  bottom: { center: [0, -2, 8], radius: 8 },
  open: { center: [0, 3, 0], radius: 12 }
};

function classifyBiome(species) {
  const biotope = (species.ecology?.biotope || "").toLowerCase();
  const family = (species.family || "").toLowerCase();
  const social = (species.ecology?.socialBehavior || "").toLowerCase();

  // Rocky / Cave dwellers
  if (
    biotope.includes("rock") ||
    biotope.includes("cave") ||
    biotope.includes("rift") ||
    family === "cichlidae"
  ) {
    return "rocky";
  }

  // Bottom dwellers / driftwood
  if (
    family === "loricariidae" ||
    family === "corydoradinae" ||
    family === "callichthyidae" ||
    biotope.includes("driftwood") ||
    biotope.includes("bottom") ||
    biotope.includes("substrate")
  ) {
    return "bottom";
  }

  // Planted community
  if (
    family === "characidae" ||
    family === "poeciliidae" ||
    family === "osphronemidae" ||
    biotope.includes("plant") ||
    biotope.includes("vegetation")
  ) {
    return "planted";
  }

  // Default: open water
  return "open";
}

function getSchoolSize(species) {
  const social = (species.ecology?.socialBehavior || "").toLowerCase();
  if (social.includes("school") || social.includes("group")) {
    // Extract numbers like "5+" or "6-8"
    const match = social.match(/(\d+)/);
    if (match) return Math.min(parseInt(match[1], 10), 8);
    return 5;
  }
  if (social.includes("pair")) return 2;
  if (social.includes("solitary") || social.includes("territorial")) return 1;
  return 3; // default small group
}

export function SpeciesSwarm({ speciesData, onInspect, tankMode = false }) {
  // In tank mode: show all species with their actual counts
  // In master mode: limit to first 40 for performance
  const activeSpecies = useMemo(() => {
    if (tankMode) return speciesData;
    return speciesData.slice(0, 40);
  }, [speciesData, tankMode]);

  const classified = useMemo(() => {
    return activeSpecies.map((sp, idx) => ({
      species: sp,
      biome: classifyBiome(sp),
      schoolSize: tankMode ? (sp._tankCount || getSchoolSize(sp)) : getSchoolSize(sp),
      index: idx
    }));
  }, [activeSpecies, tankMode]);

  return (
    <group>
      {classified.map(({ species, biome, schoolSize, index }) => {
        const zone = BIOME_ZONES[biome];
        // Spread schools within their zone
        const angle = (index / classified.length) * Math.PI * 2;
        const dist = Math.random() * zone.radius * 0.7;
        const basePos = [
          zone.center[0] + Math.cos(angle) * dist,
          zone.center[1] + (Math.random() - 0.5) * 2,
          zone.center[2] + Math.sin(angle) * dist
        ];

        return (
          <FishSchool
            key={species.specCode || index}
            species={species}
            count={schoolSize}
            position={basePos}
            onInspect={() => onInspect(species)}
          />
        );
      })}
    </group>
  );
}
