import React, { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CausticsProjector } from "./CausticsShader";
import { GodRays } from "./GodRays";
import { BubbleParticles } from "./BubbleParticles";

/**
 * ReefEnvironment — Underwater scene with caustics, god rays, bubbles,
 * biome terrain, and atmosphere.
 */
export function ReefEnvironment() {
  // Set fog via useEffect to avoid re-creating every render
  const { scene } = useThree();
  React.useEffect(() => {
    scene.fog = new THREE.Fog("#0a2a4a", 8, 55);
    return () => { scene.fog = null; };
  }, [scene]);

  return (
    <group>
      {/* Lighting */}
      <ambientLight intensity={0.8} color="#b8d4e3" />
      <directionalLight position={[10, 25, 5]} intensity={1.2} color="#ffffff" />
      <directionalLight position={[-5, 15, -10]} intensity={0.4} color="#87ceeb" />
      <pointLight position={[-8, 6, -12]} intensity={0.4} color="#00e5ff" />
      <pointLight position={[12, 3, 8]} intensity={0.3} color="#22c55e" />
      <hemisphereLight skyColor="#87ceeb" groundColor="#1a4a6a" intensity={0.5} />

      {/* Sand floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, 0]}>
        <planeGeometry args={[80, 80, 32, 32]} />
        <meshStandardMaterial color="#3d2b10" roughness={0.95} metalness={0} />
      </mesh>

      {/* Caustics */}
      <CausticsProjector />

      {/* God rays */}
      <GodRays count={10} />

      {/* Bubbles */}
      <BubbleParticles count={100} />

      {/* Rocky zone */}
      <RockFormations />

      {/* Plants */}
      <PlantBed />

      {/* Driftwood */}
      <DriftwoodCluster />

      {/* Corals */}
      <CoralGarden />

      {/* Plankton */}
      <PlanktonParticles count={1000} />

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
    for (let i = 0; i < 15; i++) {
      items.push({
        position: [-12 + (Math.random() - 0.5) * 10, -3 + Math.random() * 2, -8 + (Math.random() - 0.5) * 10],
        scale: [0.6 + Math.random() * 1.8, 0.4 + Math.random() * 1.5, 0.6 + Math.random() * 1.8],
        rotation: [Math.random() * 0.5, Math.random() * Math.PI, Math.random() * 0.3],
        color: ["#4a4a4a", "#5c4a3a", "#3a3a3a"][i % 3]
      });
    }
    return items;
  }, []);

  return (
    <group>
      {rocks.map((rock, i) => (
        <mesh key={i} position={rock.position} rotation={rock.rotation} scale={rock.scale}>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={rock.color} roughness={0.92} />
        </mesh>
      ))}
    </group>
  );
}

function PlantBed() {
  const plants = useMemo(() => {
    const items = [];
    for (let i = 0; i < 14; i++) {
      items.push({
        x: 10 + (Math.random() - 0.5) * 10,
        z: -5 + (Math.random() - 0.5) * 10,
        height: 1.5 + Math.random() * 3,
        color: ["#1a5c1a", "#2d7a2d", "#0f4f0f"][i % 3],
        phase: Math.random() * Math.PI * 2
      });
    }
    return items;
  }, []);

  return (
    <group>
      {plants.map((p, i) => (
        <PlantStalk key={i} x={p.x} z={p.z} height={p.height} color={p.color} phase={p.phase} />
      ))}
    </group>
  );
}

function PlantStalk({ x, z, height, color, phase }) {
  const ref = useRef();
  useFrame((state) => {
    if (ref.current) {
      const t = state.clock.elapsedTime;
      ref.current.rotation.x = Math.sin(t * 0.8 + phase) * 0.1;
      ref.current.rotation.z = Math.cos(t * 0.6 + phase) * 0.05;
    }
  });
  return (
    <mesh ref={ref} position={[x, -3 + height / 2, z]}>
      <cylinderGeometry args={[0.02, 0.05, height, 6]} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}

function DriftwoodCluster() {
  const logs = useMemo(() => {
    const items = [];
    for (let i = 0; i < 5; i++) {
      items.push({
        position: [(Math.random() - 0.5) * 8, -3 + Math.random() * 0.3, 8 + (Math.random() - 0.5) * 8],
        rotation: [Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.3],
        length: 1 + Math.random() * 3,
        radius: 0.08 + Math.random() * 0.12
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

function CoralGarden() {
  const corals = useMemo(() => {
    const colors = ["#ff6b6b", "#ffa07a", "#9b59b6", "#f39c12", "#e74c3c", "#1abc9c", "#e91e63"];
    const items = [];
    for (let i = 0; i < 35; i++) {
      items.push({
        position: [(Math.random() - 0.5) * 40, -2.8 + Math.random() * 0.3, (Math.random() - 0.5) * 40],
        scale: 0.2 + Math.random() * 0.6,
        color: colors[Math.floor(Math.random() * colors.length)],
        isBranch: Math.random() > 0.5
      });
    }
    return items;
  }, []);

  return (
    <group>
      {corals.map((c, i) => (
        <mesh key={i} position={c.position} scale={c.scale}>
          {c.isBranch ? <coneGeometry args={[0.2, 1.5, 5]} /> : <sphereGeometry args={[0.7, 8, 6]} />}
          <meshStandardMaterial color={c.color} roughness={0.7} emissive={c.color} emissiveIntensity={0.08} />
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
