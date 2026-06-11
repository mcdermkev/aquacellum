import React, { useRef, useMemo, useState, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * ReefFlora — renders a catalog *plant* species as a small clump of upright,
 * floor-anchored billboards that sway with the current (instead of swimming
 * around as flat rectangles like the fish sprites).
 *
 * Each plant:
 *  - is pinned with its base on the substrate (geometry pivot at the base),
 *  - yaw-billboards toward the camera so it always reads as a leafy plane,
 *  - sways gently from the base, phase-offset per blade.
 */

const FLOOR_Y = -3; // matches ReefEnvironment sand floor

function getSlug(species) {
  return (species.scientificName || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/** A single swaying plant blade (one upright plane, base-anchored). */
function PlantBlade({ texture, aspect, height, phase }) {
  const pivotRef = useRef();
  const { camera } = useThree();

  // Plane whose pivot sits at the bottom edge, so it "grows" from the floor.
  const geometry = useMemo(() => {
    const width = height * aspect;
    const geo = new THREE.PlaneGeometry(width, height);
    geo.translate(0, height / 2, 0);
    return geo;
  }, [height, aspect]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    const pivot = pivotRef.current;
    if (!pivot) return;
    const t = state.clock.elapsedTime;

    // Yaw-billboard: face the camera but stay vertical.
    const dx = camera.position.x - pivot.position.x;
    const dz = camera.position.z - pivot.position.z;
    pivot.rotation.y = Math.atan2(dx, dz);

    // Gentle current sway from the base.
    pivot.rotation.z = Math.sin(t * 0.8 + phase) * 0.08 + Math.sin(t * 1.7 + phase) * 0.03;
  });

  return (
    <group ref={pivotRef}>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          map={texture}
          transparent
          alphaTest={0.25}
          side={THREE.DoubleSide}
          roughness={0.85}
          metalness={0}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Plant — a clump of 2–4 blades of one species, rooted around `position`.
 */
export function Plant({ species, position, onInspect }) {
  const slug = getSlug(species);
  const [texture, setTexture] = useState(null);
  const [aspect, setAspect] = useState(0.6);

  useEffect(() => {
    if (!slug) return;
    const loader = new THREE.TextureLoader();
    const load = (url, onFail) =>
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          const img = tex.image;
          if (img && img.width && img.height) setAspect(img.width / img.height);
          setTexture(tex);
        },
        undefined,
        onFail
      );
    // Prefer the transparent cutout; fall back to the original photo.
    load(`/species-cutouts/${slug}.png`, () => load(`/species-images/${slug}.png`));
  }, [slug]);

  // Height from plant size if available, else a sensible aquarium default.
  const baseHeight = useMemo(() => {
    const cm = species.maxLengthCm || 25;
    return Math.max(2.2, Math.min(6, cm / 6));
  }, [species.maxLengthCm]);

  // A few blades clustered around the root point.
  const blades = useMemo(() => {
    const n = 2 + Math.floor(Math.random() * 3); // 2–4
    return Array.from({ length: n }, () => ({
      offset: [(Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6],
      height: baseHeight * (0.75 + Math.random() * 0.5),
      phase: Math.random() * Math.PI * 2,
    }));
  }, [baseHeight]);

  if (!texture) return null;

  return (
    <group
      position={[position[0], FLOOR_Y, position[2]]}
      onClick={(e) => { e.stopPropagation(); onInspect?.(); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = "default"; }}
    >
      {blades.map((b, i) => (
        <group key={i} position={b.offset}>
          <PlantBlade texture={texture} aspect={aspect} height={b.height} phase={b.phase} />
        </group>
      ))}
    </group>
  );
}
