import React, { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * TankEnvironment — Generates the 3D environment based on tank metadata.
 *
 * Scales the world to match tank volume:
 * - Small tanks (< 50L): Enclosed glass-walled room
 * - Medium tanks (50-200L): Open but bounded area
 * - Large tanks (200L+): Full open reef feel
 *
 * Colors/mood influenced by water params:
 * - Warm water → amber lighting
 * - Cool water → blue tones
 * - Low pH (blackwater) → amber fog
 * - High pH (rift lake) → clear blue, bright lighting
 */
export function TankEnvironment({ tankMeta }) {
  const config = useMemo(() => computeEnvironmentConfig(tankMeta), [tankMeta]);

  return (
    <group>
      {/* Lighting tuned to water params */}
      <ambientLight intensity={config.ambientIntensity} color={config.ambientColor} />
      <directionalLight
        position={[config.worldRadius * 0.5, 12, config.worldRadius * 0.3]}
        intensity={config.sunIntensity}
        color={config.sunColor}
      />
      <pointLight position={[0, 5, 0]} intensity={0.15} color={config.accentColor} />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2, 0]}>
        <planeGeometry args={[config.worldRadius * 2.5, config.worldRadius * 2.5]} />
        <meshStandardMaterial color={config.floorColor} roughness={0.95} />
      </mesh>

      {/* Glass walls for small tanks */}
      {config.hasWalls && <GlassWalls radius={config.worldRadius} height={config.wallHeight} />}

      {/* Substrate details */}
      <SubstrateDetails count={config.substrateCount} radius={config.worldRadius} />

      {/* Plants (if tropical/planted tank) */}
      {config.plantCount > 0 && (
        <TankPlants count={config.plantCount} radius={config.worldRadius} color={config.plantColor} />
      )}

      {/* Rocks */}
      {config.rockCount > 0 && (
        <TankRocks count={config.rockCount} radius={config.worldRadius} />
      )}

      {/* Water surface shimmer */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, config.wallHeight - 0.5, 0]}>
        <planeGeometry args={[config.worldRadius * 2.5, config.worldRadius * 2.5]} />
        <meshStandardMaterial
          color={config.waterSurfaceColor}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function computeEnvironmentConfig(tankMeta) {
  const volume = tankMeta?.volumeLiters || 100;
  const temp = tankMeta?.tempCelsius || 25;
  const ph = tankMeta?.ph || 7.0;

  // Scale world to tank volume
  const worldRadius = Math.max(4, Math.min(25, Math.sqrt(volume) * 0.8));
  const wallHeight = Math.max(4, Math.min(12, Math.cbrt(volume) * 1.5));

  // Enclosed walls for small tanks
  const hasWalls = volume < 120;

  // Temperature → lighting warmth
  const isWarm = temp >= 26;
  const isCool = temp <= 22;
  const sunColor = isWarm ? "#ffd699" : isCool ? "#87ceeb" : "#fffacd";
  const sunIntensity = isWarm ? 0.7 : 0.5;
  const ambientColor = isWarm ? "#2a1f0a" : isCool ? "#0a1a2a" : "#1a2a3a";
  const ambientIntensity = 0.35;

  // pH → fog/water color
  const isAcidic = ph < 6.5; // blackwater
  const isAlkaline = ph > 7.8; // rift lake
  const accentColor = isAcidic ? "#8b5a2b" : isAlkaline ? "#00bfff" : "#38bdf8";
  const floorColor = isAcidic ? "#2a1500" : isAlkaline ? "#c2b280" : "#3d2b10";
  const waterSurfaceColor = isAcidic ? "#5c3317" : "#1a8fbd";
  const plantColor = isAcidic ? "#2e5c1a" : "#1a5c1a";

  // Decorations scale with tank size
  const plantCount = isAlkaline ? 2 : Math.min(15, Math.floor(volume / 15));
  const rockCount = isAlkaline ? Math.min(12, Math.floor(volume / 12)) : Math.min(6, Math.floor(volume / 30));
  const substrateCount = Math.min(20, Math.floor(volume / 10));

  return {
    worldRadius,
    wallHeight,
    hasWalls,
    sunColor,
    sunIntensity,
    ambientColor,
    ambientIntensity,
    accentColor,
    floorColor,
    waterSurfaceColor,
    plantColor,
    plantCount,
    rockCount,
    substrateCount
  };
}

function GlassWalls({ radius, height }) {
  const wallMat = useMemo(() => (
    <meshStandardMaterial color="#88ccff" transparent opacity={0.08} side={THREE.DoubleSide} roughness={0.1} metalness={0.3} />
  ), []);

  return (
    <group>
      {/* Four glass panels forming a tank */}
      <mesh position={[0, height / 2 - 2, -radius]}>
        <planeGeometry args={[radius * 2, height]} />
        {wallMat}
      </mesh>
      <mesh position={[0, height / 2 - 2, radius]}>
        <planeGeometry args={[radius * 2, height]} />
        {wallMat}
      </mesh>
      <mesh position={[-radius, height / 2 - 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[radius * 2, height]} />
        {wallMat}
      </mesh>
      <mesh position={[radius, height / 2 - 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[radius * 2, height]} />
        {wallMat}
      </mesh>
    </group>
  );
}

function SubstrateDetails({ count, radius }) {
  const pebbles = useMemo(() => {
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push({
        pos: [(Math.random() - 0.5) * radius * 1.8, -1.95, (Math.random() - 0.5) * radius * 1.8],
        scale: 0.05 + Math.random() * 0.15,
        color: ["#8b7355", "#a0937a", "#6b5b4b", "#9e8c6c"][i % 4]
      });
    }
    return items;
  }, [count, radius]);

  return (
    <group>
      {pebbles.map((p, i) => (
        <mesh key={i} position={p.pos} scale={p.scale}>
          <sphereGeometry args={[1, 6, 4]} />
          <meshStandardMaterial color={p.color} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function TankPlants({ count, radius, color }) {
  const plants = useMemo(() => {
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push({
        x: (Math.random() - 0.5) * radius * 1.5,
        z: (Math.random() - 0.5) * radius * 1.5,
        height: 1 + Math.random() * 2.5
      });
    }
    return items;
  }, [count, radius]);

  return (
    <group>
      {plants.map((p, i) => (
        <mesh key={i} position={[p.x, -2 + p.height / 2, p.z]}>
          <cylinderGeometry args={[0.015, 0.04, p.height, 5]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function TankRocks({ count, radius }) {
  const rocks = useMemo(() => {
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push({
        pos: [(Math.random() - 0.5) * radius * 1.4, -2 + Math.random() * 0.8, (Math.random() - 0.5) * radius * 1.4],
        scale: 0.3 + Math.random() * 0.8,
        rotation: [Math.random(), Math.random() * Math.PI, 0]
      });
    }
    return items;
  }, [count, radius]);

  return (
    <group>
      {rocks.map((r, i) => (
        <mesh key={i} position={r.pos} scale={r.scale} rotation={r.rotation}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#5a5a5a" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
