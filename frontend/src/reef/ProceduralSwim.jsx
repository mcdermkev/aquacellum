import React, { useRef, useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { enhanceFishMaterials } from "./utils/enhanceFishMaterials";
import { getReefEnvMap } from "./utils/reefEnvMap";

/**
 * ProceduralSwim — Loads a static GLB fish model and applies
 * code-driven swim animation (no bones/rig required).
 *
 * Animation approach:
 * - Sine wave deformation along the body (spine undulation)
 * - Tail oscillation with frequency based on fish size
 * - Subtle pectoral fin flutter (side-to-side)
 * - Gentle vertical bob
 *
 * Works by modifying vertex positions each frame using the mesh's
 * local X axis as the "spine direction" (nose = +X, tail = -X).
 */
export function ProceduralSwim({
  src,
  scale = 1,
  speed = 1.0,
  amplitude = 1.0,
  children
}) {
  const groupRef = useRef();
  const meshRefs = useRef([]);
  const originalPositions = useRef(new Map());
  const phaseRef = useRef(Math.random() * Math.PI * 2);

  // Load GLB model
  const { scene } = useGLTF(src);
  const { gl } = useThree();

  // Clone the scene, normalise materials, and extract meshes for animation
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    enhanceFishMaterials(clone, { renderer: gl, envMap: getReefEnvMap(gl) });

    const meshes = [];
    clone.traverse((child) => {
      if (child.isMesh && child.geometry) meshes.push(child);
    });
    meshRefs.current = meshes;
    return clone;
  }, [scene, gl]);

  // Store original vertex positions on first load
  useEffect(() => {
    const originals = new Map();
    meshRefs.current.forEach((mesh) => {
      const posAttr = mesh.geometry.attributes.position;
      if (posAttr) {
        originals.set(mesh.uuid, posAttr.array.slice());
      }
    });
    originalPositions.current = originals;
  }, [clonedScene]);

  // Animate vertices each frame
  useFrame((state) => {
    if (!groupRef.current) return;
    const time = state.clock.elapsedTime * speed;
    const phase = phaseRef.current;

    meshRefs.current.forEach((mesh) => {
      const posAttr = mesh.geometry.attributes.position;
      const original = originalPositions.current.get(mesh.uuid);
      if (!posAttr || !original) return;

      // Get bounding box to normalize positions along spine
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bbox = mesh.geometry.boundingBox;
      const length = bbox.max.x - bbox.min.x;
      const minX = bbox.min.x;

      if (length === 0) return;

      const arr = posAttr.array;

      for (let i = 0; i < arr.length; i += 3) {
        const ox = original[i];
        const oy = original[i + 1];
        const oz = original[i + 2];

        // Normalized position along body (0 = nose, 1 = tail)
        const t = (ox - minX) / length;

        // Spine undulation: sine wave that increases toward the tail
        // The tail moves more than the head
        const tailFactor = t * t; // Quadratic increase toward tail
        const spineWave = Math.sin(time * 4 + phase + t * Math.PI * 2) * tailFactor * amplitude * 0.08;

        // Apply Z displacement (side-to-side swimming motion)
        arr[i] = ox; // X stays (forward/back)
        arr[i + 1] = oy + Math.sin(time * 2 + phase) * 0.005 * amplitude; // subtle vertical bob
        arr[i + 2] = oz + spineWave; // Z = side-to-side undulation
      }

      posAttr.needsUpdate = true;
    });

    // Whole-body gentle sway (supplements vertex animation)
    groupRef.current.rotation.z = Math.sin(time * 2 + phase) * 0.03 * amplitude;
    groupRef.current.position.y = Math.sin(time * 1.5 + phase) * 0.02;
  });

  return (
    <group ref={groupRef} scale={scale}>
      <primitive object={clonedScene} />
    </group>
  );
}

/**
 * SwimmingFishGLB — Higher-level component that loads a GLB and applies swim.
 * Use this in place of static model loading.
 *
 * Props:
 * - src: path to GLB file
 * - scale: model scale
 * - swimSpeed: how fast the tail beats (small fish = faster)
 * - swimAmplitude: how much the body bends (long fish = more)
 */
export function SwimmingFishGLB({
  src,
  scale = 1,
  swimSpeed = 1.0,
  swimAmplitude = 1.0
}) {
  return (
    <ProceduralSwim
      src={src}
      scale={scale}
      speed={swimSpeed}
      amplitude={swimAmplitude}
    />
  );
}

/**
 * Compute swim parameters from species data.
 * Smaller fish swim faster, longer fish undulate more.
 */
export function getSwimParams(species) {
  const maxLen = species?.maxLengthCm || 5;

  // Speed: inversely proportional to size (small = darty, large = languid)
  const swimSpeed = Math.max(0.5, Math.min(2.0, 8 / maxLen));

  // Amplitude: proportional to body length (eels bend more than disc-shaped fish)
  const swimAmplitude = Math.max(0.5, Math.min(1.5, maxLen / 10));

  // Scale factor — TripoSR models are ~1 unit, scale them down to scene size
  const modelScale = Math.max(0.15, Math.min(0.6, maxLen / 30));

  return { swimSpeed, swimAmplitude, modelScale };
}
