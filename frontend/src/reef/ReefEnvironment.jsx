import React, { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CausticsProjector } from "./CausticsShader";
import { GodRays } from "./GodRays";
import { BubbleParticles } from "./BubbleParticles";
import { PlantedEnvironment } from "./PlantedEnvironment";
import { BiomeFloor, BiomeBackdrop } from "./GenerativeReef";

/**
 * ReefEnvironment — Freshwater planted aquarium scene with caustics,
 * god rays, bubbles, real plant cutouts, rocks, and driftwood.
 */
export function ReefEnvironment() {
  const { scene } = useThree();
  React.useEffect(() => {
    // Warm green-tinted fog for freshwater (not ocean-blue).
    scene.fog = new THREE.Fog("#0b1f1a", 15, 85);
    return () => { scene.fog = null; };
  }, [scene]);

  return (
    <group>
      {/* Lighting — warmer, greener, freshwater feel */}
      <ambientLight intensity={0.7} color="#d4e8d0" />
      <directionalLight position={[10, 25, 5]} intensity={1.0} color="#ffe8c0" />
      <directionalLight position={[-5, 15, -10]} intensity={0.35} color="#a8d8a0" />
      <pointLight position={[-8, 6, -12]} intensity={0.3} color="#4caf50" />
      <pointLight position={[12, 3, 8]} intensity={0.25} color="#81c784" />
      <hemisphereLight skyColor="#b8e0b0" groundColor="#1a3a1a" intensity={0.45} />

      {/* Far underwater backdrop + textured substrate (Dutch planted set) */}
      <BiomeBackdrop biomeType="dutch_planted" />
      <BiomeFloor biomeType="dutch_planted" />

      {/* Caustics */}
      <CausticsProjector />

      {/* God rays */}
      <GodRays count={10} />

      {/* Bubbles */}
      <BubbleParticles count={100} />

      {/* Rocky zone — freshwater Seiryu-style */}
      <RockFormations />

      {/* Real plant cutouts — dense freshwater planting */}
      <PlantedEnvironment />

      {/* Driftwood */}
      <DriftwoodCluster />

      {/* Plankton / detritus */}
      <PlanktonParticles count={800} />

      {/* Water surface */}
      <WaterSurface />
    </group>
  );
}

function WaterSurface() {
  const meshRef = useRef();
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.y = 14 + Math.sin(state.clock.elapsedTime * 0.3) * 0.2;
    }
  });
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 14, 0]}>
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial color="#1a8fbd" transparent opacity={0.25} side={THREE.DoubleSide} />
    </mesh>
  );
}

function RockFormations() {
  const rocks = useMemo(() => {
    const items = [];
    // Scatter rocks wider across the world for freshwater aquascape feel.
    const rng = seededRand(42);
    for (let i = 0; i < 25; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = 5 + rng() * 35;
      items.push({
        position: [Math.cos(angle) * dist, -3 + rng() * 1.2, Math.sin(angle) * dist],
        scale: [0.5 + rng() * 2.2, 0.4 + rng() * 1.8, 0.5 + rng() * 2.0],
        rotation: [rng() * 0.4, rng() * Math.PI, rng() * 0.3],
        // Seiryu / Dragon stone palette: blue-grays and slate.
        color: ["#5a6a72", "#4a5a60", "#3d4d55", "#6a7a82", "#4d5d65"][i % 5]
      });
    }
    return items;
  }, []);

  return (
    <group>
      {rocks.map((rock, i) => (
        <mesh key={i} position={rock.position} rotation={rock.rotation} scale={rock.scale}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={rock.color} roughness={0.88} metalness={0.05} flatShading />
        </mesh>
      ))}
    </group>
  );
}

// Deterministic PRNG (same as SpeciesSwarm).
function seededRand(seed) {
  let s = seed | 0;
  return () => { s = (s * 1664525 + 1013904223) | 0; return (s >>> 0) / 4294967296; };
}

function DriftwoodCluster() {
  const logs = useMemo(() => {
    const items = [];
    const rng = seededRand(1337);
    for (let i = 0; i < 12; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = 3 + rng() * 28;
      items.push({
        position: [Math.cos(angle) * dist, -3 + rng() * 0.3, Math.sin(angle) * dist],
        rotation: [rng() * 0.3, rng() * Math.PI, rng() * 0.3],
        length: 1.5 + rng() * 4,
        radius: 0.06 + rng() * 0.14
      });
    }
    return items;
  }, []);

  return (
    <group>
      {logs.map((log, i) => (
        <mesh key={i} position={log.position} rotation={log.rotation}>
          <cylinderGeometry args={[log.radius, log.radius * 1.3, log.length, 8]} />
          <meshStandardMaterial color="#4a3520" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function PlanktonParticles({ count = 1000 }) {
  const ref = useRef();

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 50;
      arr[i * 3 + 1] = -3 + Math.random() * 16;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 50;
    }
    return arr;
  }, [count]);

  useEffect(() => {
    if (!ref.current) return;
    const geo = ref.current.geometry;
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  }, [positions]);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    const posAttr = ref.current.geometry.attributes.position;
    if (!posAttr) return;
    for (let i = 0; i < count; i++) {
      posAttr.array[i * 3] += Math.sin(t * 0.5 + i * 0.1) * 0.0008;
      posAttr.array[i * 3 + 1] += 0.0003;
      if (posAttr.array[i * 3 + 1] > 14) posAttr.array[i * 3 + 1] = -3;
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry />
      <pointsMaterial size={0.03} color="#88ccff" transparent opacity={0.4} sizeAttenuation />
    </points>
  );
}
