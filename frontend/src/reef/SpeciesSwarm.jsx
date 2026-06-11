import React, { useMemo } from "react";
import { FishSchool } from "./FishSchool";
import { Plant } from "./ReefFlora";
import { isPlant } from "./flora";
import { useBiomeClassifier, getSpeciesForBiome } from "./hooks/useBiomeClassifier";

function swarmSlug(species) {
  return (species.scientificName || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * SpeciesSwarm — Takes the full species dataset and renders each species
 * as a swimming school scattered across a large explorable reef.
 *
 * When a biome is active (not "default"), only species classified for that
 * biome are shown — each biome has its own unique cast of fish.
 *
 * In "default" mode (master reef), all species are shown spread across 4
 * positional zones for the classic full-catalog experience.
 */

// Deterministic hash to avoid Math.random() re-rolls per render.
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}
function seededRand(seed) {
  let s = seed | 0;
  return () => { s = (s * 1664525 + 1013904223) | 0; return (s >>> 0) / 4294967296; };
}

// Biome zones — larger, more spread out, overlapping.
const BIOME_ZONES = {
  rocky:   { center: [-25, 0, -18], radius: 18 },
  planted: { center: [22, 0, -12], radius: 16 },
  bottom:  { center: [0, -2.5, 20], radius: 16 },
  open:    { center: [0, 2, 0], radius: 28 },
};

function classifyBiome(species) {
  const biotope = (species.ecology?.biotope || "").toLowerCase();
  const family = (species.family || "").toLowerCase();

  if (
    biotope.includes("rock") || biotope.includes("cave") ||
    biotope.includes("rift") || family === "cichlidae"
  ) return "rocky";

  if (
    family === "loricariidae" || family === "corydoradinae" ||
    family === "callichthyidae" || biotope.includes("driftwood") ||
    biotope.includes("bottom") || biotope.includes("substrate")
  ) return "bottom";

  if (
    family === "characidae" || family === "poeciliidae" ||
    family === "osphronemidae" || biotope.includes("plant") ||
    biotope.includes("vegetation")
  ) return "planted";

  return "open";
}

function getSchoolSize(species) {
  const social = (species.ecology?.socialBehavior || "").toLowerCase();
  if (social.includes("school") || social.includes("group")) {
    const match = social.match(/(\d+)/);
    if (match) return Math.min(parseInt(match[1], 10), 6);
    return 4;
  }
  if (social.includes("pair")) return 2;
  if (social.includes("solitary") || social.includes("territorial")) return 1;
  return 2; // smaller default — feels less crowded per spot
}

export function SpeciesSwarm({ speciesData, onInspect, tankMode = false, biome = "default" }) {
  // Classify all species into biomes
  const { biomeMap } = useBiomeClassifier(speciesData);

  // Select species based on active biome
  const activeSpecies = useMemo(() => {
    if (tankMode) return speciesData;

    if (biome && biome !== "default") {
      // Biome-specific: show only species belonging to this biome
      return getSpeciesForBiome(biomeMap, biome);
    }

    // Default reef: show a mix from all biomes (up to 60)
    return speciesData.slice(0, 60);
  }, [speciesData, tankMode, biome, biomeMap]);

  const classified = useMemo(() => {
    return activeSpecies.map((sp, idx) => {
      const slug = swarmSlug(sp);
      const rng = seededRand(hashStr(slug || `sp${idx}`));
      const biome = classifyBiome(sp);
      const zone = BIOME_ZONES[biome];

      // Golden-angle spiral within the zone for even spread.
      const goldenAngle = 2.399963; // radians
      const angle = idx * goldenAngle;
      const dist = zone.radius * (0.3 + rng() * 0.7);

      // Y: bottom dwellers stay low, open/planted mid-water, rocky scattered.
      let baseY = zone.center[1] + (rng() - 0.4) * 4;
      if (biome === "bottom") baseY = Math.min(baseY, -1.5);
      // Never seed a school center below the substrate (floor at y = -3).
      baseY = Math.max(baseY, -2.4);

      const basePos = [
        zone.center[0] + Math.cos(angle) * dist,
        baseY,
        zone.center[2] + Math.sin(angle) * dist,
      ];

      return {
        species: sp,
        biome,
        schoolSize: tankMode ? (sp._tankCount || getSchoolSize(sp)) : getSchoolSize(sp),
        index: idx,
        basePos,
        slug,
      };
    });
  }, [activeSpecies, tankMode]);

  return (
    <group>
      {classified.map(({ species, biome, schoolSize, index, basePos, slug }) => {
        // Plants are rooted on the substrate and sway — they don't swim.
        if (isPlant(slug)) {
          return (
            <Plant
              key={species.specCode || index}
              species={species}
              position={basePos}
              onInspect={() => onInspect(species)}
            />
          );
        }

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
