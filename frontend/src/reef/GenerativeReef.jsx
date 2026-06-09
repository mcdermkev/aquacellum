import React, { useState, useCallback, useMemo } from "react";
import * as THREE from "three";

/**
 * GenerativeReef — Dynamic reef terrain generated from text descriptions.
 *
 * Pipeline:
 * 1. User describes a biome ("a deep volcanic vent with orange coral")
 * 2. Description → Poseidon API → structured terrain parameters
 * 3. Parameters → procedural generation of terrain, color, density
 *
 * This is the "describe a world, walk into it" prototype.
 * For Phase 3 MVP: works with predefined biome templates + randomization.
 * Future: integrate with actual generative 3D models (TRELLIS, etc.)
 */

// Biome templates that can be generated or mixed
const BIOME_TEMPLATES = {
  volcanic_vent: {
    floorColor: "#1a0a0a",
    fogColor: "#2a0a0a",
    corals: ["#ff4500", "#ff6b35", "#ffa500", "#8b0000"],
    rockColor: "#2d1f1f",
    lightColor: "#ff4500",
    lightIntensity: 0.4,
    particleColor: "#ff6b35",
    hasVents: true,
    plantDensity: 0,
    coralDensity: 15,
    rockDensity: 8
  },
  tropical_shallow: {
    floorColor: "#f5deb3",
    fogColor: "#1a6b8a",
    corals: ["#ff69b4", "#00ff7f", "#ffd700", "#ff6347", "#7b68ee"],
    rockColor: "#a0a0a0",
    lightColor: "#fffacd",
    lightIntensity: 0.8,
    particleColor: "#ffffff",
    hasVents: false,
    plantDensity: 12,
    coralDensity: 30,
    rockDensity: 5
  },
  deep_kelp_forest: {
    floorColor: "#1a2a1a",
    fogColor: "#0a2a1a",
    corals: ["#2e8b57", "#3cb371", "#006400"],
    rockColor: "#4a4a3a",
    lightColor: "#90ee90",
    lightIntensity: 0.3,
    particleColor: "#90ee90",
    hasVents: false,
    plantDensity: 25,
    coralDensity: 5,
    rockDensity: 10
  },
  crystal_cave: {
    floorColor: "#0a0a2a",
    fogColor: "#0a0a3a",
    corals: ["#e0e0ff", "#b0c4de", "#4169e1", "#9370db"],
    rockColor: "#2a2a4a",
    lightColor: "#6a5acd",
    lightIntensity: 0.5,
    particleColor: "#e0e0ff",
    hasVents: false,
    plantDensity: 0,
    coralDensity: 20,
    rockDensity: 15
  },
  amazonian_blackwater: {
    floorColor: "#2a1f0a",
    fogColor: "#1a0f05",
    corals: [],
    rockColor: "#4a3520",
    lightColor: "#daa520",
    lightIntensity: 0.25,
    particleColor: "#8b7355",
    hasVents: false,
    plantDensity: 8,
    coralDensity: 0,
    rockDensity: 4
  }
};

export function GenerativeReef({ biomeType = "tropical_shallow", seed = 42, radius = 20 }) {
  const template = BIOME_TEMPLATES[biomeType] || BIOME_TEMPLATES.tropical_shallow;

  // Seeded random for reproducible generation
  const rng = useMemo(() => createSeededRandom(seed), [seed]);

  const elements = useMemo(() => {
    const items = { rocks: [], corals: [], plants: [], vents: [] };

    // Generate rocks
    for (let i = 0; i < template.rockDensity; i++) {
      items.rocks.push({
        position: [
          (rng() - 0.5) * radius * 2,
          -3 + rng() * 1.5,
          (rng() - 0.5) * radius * 2
        ],
        scale: 0.5 + rng() * 2.5,
        rotation: [rng() * Math.PI, rng() * Math.PI, rng() * 0.5]
      });
    }

    // Generate corals
    for (let i = 0; i < template.coralDensity; i++) {
      items.corals.push({
        position: [
          (rng() - 0.5) * radius * 2,
          -2.9 + rng() * 0.3,
          (rng() - 0.5) * radius * 2
        ],
        scale: 0.2 + rng() * 0.8,
        color: template.corals[Math.floor(rng() * template.corals.length)],
        type: rng() > 0.5 ? "branch" : rng() > 0.5 ? "brain" : "tube"
      });
    }

    // Generate plants
    for (let i = 0; i < template.plantDensity; i++) {
      items.plants.push({
        position: [
          (rng() - 0.5) * radius * 2,
          -3,
          (rng() - 0.5) * radius * 2
        ],
        height: 1 + rng() * 4,
        color: template.corals.length > 0 ? template.corals[0] : "#2e8b57"
      });
    }

    // Generate thermal vents
    if (template.hasVents) {
      for (let i = 0; i < 4; i++) {
        items.vents.push({
          position: [
            (rng() - 0.5) * radius,
            -3,
            (rng() - 0.5) * radius
          ]
        });
      }
    }

    return items;
  }, [template, seed, radius, rng]);

  return (
    <group>
      {/* Biome-specific fog */}
      <fog attach="fog" args={[template.fogColor, 5, 40]} />

      {/* Biome lighting */}
      <ambientLight intensity={0.2} color={template.fogColor} />
      <directionalLight
        position={[5, 15, 5]}
        intensity={template.lightIntensity}
        color={template.lightColor}
      />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, 0]}>
        <planeGeometry args={[radius * 3, radius * 3, 32, 32]} />
        <meshStandardMaterial color={template.floorColor} roughness={0.95} />
      </mesh>

      {/* Rocks */}
      {elements.rocks.map((rock, i) => (
        <mesh key={`rock-${i}`} position={rock.position} rotation={rock.rotation} scale={rock.scale}>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={template.rockColor} roughness={0.9} />
        </mesh>
      ))}

      {/* Corals */}
      {elements.corals.map((coral, i) => (
        <mesh key={`coral-${i}`} position={coral.position} scale={coral.scale}>
          {coral.type === "branch" && <coneGeometry args={[0.2, 1.5, 5]} />}
          {coral.type === "brain" && <sphereGeometry args={[0.6, 8, 6]} />}
          {coral.type === "tube" && <cylinderGeometry args={[0.1, 0.15, 1.2, 8]} />}
          <meshStandardMaterial
            color={coral.color}
            emissive={coral.color}
            emissiveIntensity={0.15}
            roughness={0.7}
          />
        </mesh>
      ))}

      {/* Plants */}
      {elements.plants.map((plant, i) => (
        <mesh key={`plant-${i}`} position={[plant.position[0], plant.position[1] + plant.height / 2, plant.position[2]]}>
          <cylinderGeometry args={[0.02, 0.04, plant.height, 6]} />
          <meshStandardMaterial color={plant.color} roughness={0.8} />
        </mesh>
      ))}

      {/* Thermal vents (particle emitters placeholder) */}
      {elements.vents.map((vent, i) => (
        <group key={`vent-${i}`} position={vent.position}>
          <mesh>
            <coneGeometry args={[0.3, 0.8, 8]} />
            <meshStandardMaterial color="#3d2020" roughness={0.95} />
          </mesh>
          <pointLight
            position={[0, 0.5, 0]}
            color="#ff4500"
            intensity={0.3}
            distance={4}
          />
        </group>
      ))}

      {/* Particles matching biome */}
      <BiomeParticles count={800} color={template.particleColor} radius={radius} />
    </group>
  );
}

function BiomeParticles({ count, color, radius }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * radius * 2;
      arr[i * 3 + 1] = -3 + Math.random() * 15;
      arr[i * 3 + 2] = (Math.random() - 0.5) * radius * 2;
    }
    return arr;
  }, [count, radius]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial size={0.03} color={color} transparent opacity={0.4} sizeAttenuation />
    </points>
  );
}

// Simple seeded PRNG (mulberry32)
function createSeededRandom(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * BiomeSelector — UI component to choose/generate different biomes.
 * Can be embedded in the HUD.
 */
export function BiomeSelector({ currentBiome, onSelect }) {
  const biomes = Object.keys(BIOME_TEMPLATES);

  return (
    <div style={{
      display: "flex",
      gap: 6,
      flexWrap: "wrap"
    }}>
      {biomes.map((biome) => (
        <button
          key={biome}
          onClick={() => onSelect(biome)}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: `1px solid ${currentBiome === biome ? "#38bdf8" : "#334155"}`,
            background: currentBiome === biome ? "rgba(56, 189, 248, 0.15)" : "rgba(15, 23, 42, 0.6)",
            color: currentBiome === biome ? "#38bdf8" : "#94a3b8",
            fontSize: 11,
            cursor: "pointer",
            textTransform: "capitalize"
          }}
        >
          {biome.replace(/_/g, " ")}
        </button>
      ))}
    </div>
  );
}
