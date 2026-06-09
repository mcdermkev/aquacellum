import React, { useRef, useMemo, useState, useEffect } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { useGLTF, Sprite, SpriteMaterial } from "@react-three/drei";
import * as THREE from "three";

/**
 * FishModel — Progressive fidelity fish rendering.
 *
 * Priority order:
 * 1. GLTF model (if available at /models/fish/{slug}.glb) — full 3D with animation
 * 2. Species PNG billboard sprite (from existing /species-images/{slug}.png)
 * 3. Procedural mesh fallback (colored ellipsoid)
 *
 * This component handles the transition between fidelity levels and provides
 * consistent swim animation regardless of source.
 */

// Cache which GLTFs exist to avoid 404 hammering
const gltfAvailability = new Map();

function getSlug(species) {
  return (species.scientificName || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export function FishModel({ species, scale = 1, animated = true }) {
  const slug = getSlug(species);
  const [modelType, setModelType] = useState("checking"); // checking | gltf | sprite | procedural
  const meshRef = useRef();

  // Check for GLTF availability (only once per slug)
  useEffect(() => {
    if (gltfAvailability.has(slug)) {
      setModelType(gltfAvailability.get(slug));
      return;
    }

    // Try GLTF first
    const gltfPath = `/models/fish/${slug}.glb`;
    fetch(gltfPath, { method: "HEAD" })
      .then((res) => {
        if (res.ok) {
          gltfAvailability.set(slug, "gltf");
          setModelType("gltf");
        } else {
          // Try sprite image
          const imgPath = `/species-images/${slug}.png`;
          return fetch(imgPath, { method: "HEAD" }).then((imgRes) => {
            if (imgRes.ok) {
              gltfAvailability.set(slug, "sprite");
              setModelType("sprite");
            } else {
              gltfAvailability.set(slug, "procedural");
              setModelType("procedural");
            }
          });
        }
      })
      .catch(() => {
        gltfAvailability.set(slug, "procedural");
        setModelType("procedural");
      });
  }, [slug]);

  if (modelType === "checking") return null;
  if (modelType === "gltf") return <GLTFFish slug={slug} scale={scale} animated={animated} />;
  if (modelType === "sprite") return <SpriteFish slug={slug} species={species} scale={scale} animated={animated} />;
  return <ProceduralFish species={species} scale={scale} animated={animated} />;
}

/**
 * GLTFFish — Full 3D model loaded from GLTF with skeletal animation.
 * Models should be placed at public/models/fish/{slug}.glb
 */
function GLTFFish({ slug, scale, animated }) {
  const groupRef = useRef();
  const mixerRef = useRef(null);
  const { scene, animations } = useGLTF(`/models/fish/${slug}.glb`);

  useEffect(() => {
    if (animations && animations.length > 0 && animated) {
      const mixer = new THREE.AnimationMixer(scene);
      const action = mixer.clipAction(animations[0]);
      action.play();
      mixerRef.current = mixer;
    }
    return () => {
      if (mixerRef.current) mixerRef.current.stopAllAction();
    };
  }, [scene, animations, animated]);

  useFrame((_, delta) => {
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }
  });

  return (
    <group ref={groupRef} scale={scale * 0.01}>
      <primitive object={scene.clone()} />
    </group>
  );
}

/**
 * SpriteFish — Species PNG rendered as a 3D billboard sprite.
 * Uses the existing species-images as textures on a plane.
 * Adds swim oscillation and slight perspective rotation.
 */
function SpriteFish({ slug, species, scale, animated }) {
  const meshRef = useRef();
  const [texture, setTexture] = useState(null);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.load(
      `/species-images/${slug}.png`,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        setTexture(tex);
      },
      undefined,
      () => setTexture(null)
    );
  }, [slug]);

  // Determine aspect ratio from species dimensions
  const aspect = useMemo(() => {
    // Fish are generally wider than tall (roughly 2:1 to 3:1)
    const maxLen = species.maxLengthCm || 8;
    return Math.max(1.5, Math.min(3, maxLen / 5));
  }, [species.maxLengthCm]);

  const phaseRef = useRef(Math.random() * Math.PI * 2);

  useFrame((state) => {
    if (!meshRef.current || !animated) return;
    const time = state.clock.elapsedTime;
    // Subtle vertical bob
    meshRef.current.position.y = Math.sin(time * 2 + phaseRef.current) * 0.05;
    // Gentle tilt (simulates swim undulation)
    meshRef.current.rotation.z = Math.sin(time * 3 + phaseRef.current) * 0.05;
  });

  if (!texture) {
    return <ProceduralFish species={species} scale={scale} animated={animated} />;
  }

  const width = scale * aspect * 0.4;
  const height = scale * 0.4;

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        alphaTest={0.1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * ProceduralFish — Colored mesh fallback (same as Phase 1 FishMesh).
 */
function ProceduralFish({ species, scale, animated }) {
  const meshRef = useRef();
  const phaseRef = useRef(Math.random() * Math.PI * 2);
  const color = useFamilyColor(species);

  useFrame((state) => {
    if (!meshRef.current || !animated) return;
    const time = state.clock.elapsedTime;
    meshRef.current.rotation.z = Math.sin(time * 4 + phaseRef.current) * 0.1;
  });

  return (
    <group ref={meshRef} scale={scale}>
      <mesh>
        <sphereGeometry args={[0.3, 8, 6]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[-0.4, 0, 0]} rotation={[0, 0, Math.PI / 4]}>
        <coneGeometry args={[0.15, 0.3, 4]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.1} />
      </mesh>
    </group>
  );
}

function useFamilyColor(species) {
  const COLORS = {
    cichlidae: "#f59e0b",
    characidae: "#ef4444",
    poeciliidae: "#22c55e",
    loricariidae: "#78716c",
    callichthyidae: "#a78bfa",
    osphronemidae: "#3b82f6",
    cyprinidae: "#06b6d4"
  };
  const family = (species.family || "").toLowerCase();
  return COLORS[family] || "#64748b";
}
