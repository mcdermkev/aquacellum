import React, { useRef, useMemo, Suspense } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

/**
 * CompanionGuide — Your Echo companion fish as a 3D guide.
 * Uses the generated Echo GLB models (tier-based evolution).
 * Follows the camera at a comfortable offset, reacts to inspections,
 * and serves as a spatial anchor for the narration source.
 */

// Map tier to Echo GLB model path
const TIER_MODELS = {
  "Bronze": "/models/fish/echo-fry.glb",
  "Silver": "/models/fish/echo-silver.glb",
  "Gold": "/models/fish/echo-mid.glb",
  "Master": "/models/fish/echo-evolved.glb",
  "God-Tier": "/models/fish/echo-evolved.glb",
};

const TIER_CONFIG = {
  "Bronze": { glow: "#cd7f32", scale: 0.4 },
  "Silver": { glow: "#38bdf8", scale: 0.5 },
  "Gold": { glow: "#fbbf24", scale: 0.6 },
  "Master": { glow: "#d500f9", scale: 0.75 },
  "God-Tier": { glow: "#ff6b35", scale: 0.9 },
};

/** The actual 3D Echo model with swim animation */
function EchoModel({ src, scale, glowColor, mood }) {
  const { scene } = useGLTF(src);
  const meshRefs = useRef([]);
  const originalPositions = useRef(new Map());
  const phaseRef = useRef(Math.random() * Math.PI * 2);

  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    const meshes = [];
    clone.traverse((child) => {
      if (child.isMesh && child.geometry) {
        meshes.push(child);
        if (!child.geometry.attributes.normal) {
          child.geometry.computeVertexNormals();
        }
        if (child.geometry.attributes.color) {
          const colorAttr = child.geometry.attributes.color;
          const arr = colorAttr.array;
          for (let i = 0; i < arr.length; i += colorAttr.itemSize) {
            arr[i] = Math.pow(arr[i], 0.55);
            arr[i+1] = Math.pow(arr[i+1], 0.55);
            arr[i+2] = Math.pow(arr[i+2], 0.55);
          }
          colorAttr.needsUpdate = true;
          child.material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.6,
            metalness: 0.0,
          });
        }
      }
    });
    meshRefs.current = meshes;

    // Store original positions
    const originals = new Map();
    meshes.forEach((mesh) => {
      const posAttr = mesh.geometry.attributes.position;
      if (posAttr) originals.set(mesh.uuid, posAttr.array.slice());
    });
    originalPositions.current = originals;

    return clone;
  }, [scene]);

  // Gentle swim animation
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    const phase = phaseRef.current;
    const excite = mood === "excited" ? 1.5 : 1.0;

    meshRefs.current.forEach((mesh) => {
      const posAttr = mesh.geometry.attributes.position;
      const original = originalPositions.current.get(mesh.uuid);
      if (!posAttr || !original) return;

      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bbox = mesh.geometry.boundingBox;
      const length = bbox.max.x - bbox.min.x;
      const minX = bbox.min.x;
      if (length === 0) return;

      const arr = posAttr.array;
      for (let i = 0; i < arr.length; i += 3) {
        const ox = original[i], oy = original[i + 1], oz = original[i + 2];
        const t = (ox - minX) / length;
        const tailFactor = t * t;
        const spineWave = Math.sin(time * 3 * excite + phase + t * Math.PI * 2) * tailFactor * 0.06;
        arr[i] = ox;
        arr[i + 1] = oy + Math.sin(time * 1.5 + phase) * 0.003;
        arr[i + 2] = oz + spineWave;
      }
      posAttr.needsUpdate = true;
    });
  });

  return (
    <group scale={scale}>
      <primitive object={clonedScene} />
    </group>
  );
}

/** Fallback procedural Echo (if GLB fails to load) */
function EchoFallback({ config, mood }) {
  return (
    <group>
      <mesh scale={config.scale}>
        <sphereGeometry args={[0.25, 12, 8]} />
        <meshStandardMaterial
          color={config.glow}
          emissive={config.glow}
          emissiveIntensity={mood === "excited" ? 0.5 : 0.2}
          roughness={0.3}
          metalness={0.4}
        />
      </mesh>
      <mesh position={[-0.25 * config.scale, 0, 0]} rotation={[0, 0, Math.PI / 4]} scale={config.scale}>
        <coneGeometry args={[0.12, 0.25, 4]} />
        <meshStandardMaterial color={config.glow} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

export function CompanionGuide({
  tier = "Silver",
  mood = "calm",
  inspectedSpecies = null,
  visible = true
}) {
  const groupRef = useRef();
  const targetRef = useRef(new THREE.Vector3(2, 0.5, -2));
  const { camera } = useThree();

  const config = TIER_CONFIG[tier] || TIER_CONFIG["Silver"];
  const modelSrc = TIER_MODELS[tier] || TIER_MODELS["Silver"];

  useFrame((state) => {
    if (!groupRef.current || !visible) return;
    const time = state.clock.elapsedTime;

    // Target position: offset from camera
    const offset = new THREE.Vector3(1.5, -0.3, -2);
    offset.applyQuaternion(camera.quaternion);
    const desiredPos = camera.position.clone().add(offset);

    // Smooth follow
    targetRef.current.lerp(desiredPos, 0.03);

    // Organic drift
    targetRef.current.x += Math.sin(time * 1.2) * 0.003;
    targetRef.current.y += Math.cos(time * 0.8) * 0.005;
    targetRef.current.z += Math.sin(time * 0.6) * 0.002;

    groupRef.current.position.lerp(targetRef.current, 0.08);

    // Face camera loosely
    const lookDir = camera.position.clone().sub(groupRef.current.position);
    const angle = Math.atan2(lookDir.x, lookDir.z);
    groupRef.current.rotation.y = angle + Math.PI;

    // Mood body language
    const exciteFactor = mood === "excited" ? 1.5 : 1.0;
    groupRef.current.rotation.z = Math.sin(time * 3 * exciteFactor) * 0.05;

    // Bob when inspecting
    if (inspectedSpecies) {
      groupRef.current.position.y += Math.sin(time * 4) * 0.008;
    }
  });

  if (!visible) return null;

  return (
    <group ref={groupRef}>
      <Suspense fallback={<EchoFallback config={config} mood={mood} />}>
        <EchoModel
          src={modelSrc}
          scale={config.scale}
          glowColor={config.glow}
          mood={mood}
        />
      </Suspense>

      {/* Subtle glow light */}
      <pointLight
        color={config.glow}
        intensity={mood === "excited" ? 0.4 : 0.15}
        distance={2.5}
        decay={2}
      />
    </group>
  );
}
