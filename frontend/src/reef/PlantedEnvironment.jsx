import React, { useRef, useMemo, useState, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * PlantedEnvironment — Dense freshwater plant scatter using the 12 real plant
 * cutouts as swaying, floor-rooted billboards. Categorized by size:
 *   - Carpet/foreground (small, low): cryptocoryne-parva, bucephalandra
 *   - Midground (medium): anubias, cryptocoryne-wendtii, bacopa, ludwigia, hygrophila
 *   - Background (tall): vallisneria, echinodorus
 *
 * Each instance is deterministically placed (seeded random) so positions don't
 * re-roll between renders. Plants sway gently and yaw-billboard toward camera.
 */

const FLOOR_Y = -3;

// Plant library: categorized by placement height.
// `forcePortrait` forces tall plants to render in portrait orientation even if
// the source photo is landscape (val/echinodorus photos are wide side-shots but
// the plants grow upward in a tank).
const PLANT_LIB = {
  carpet: [
    { slug: "cryptocoryne-parva", height: 1.8, forcePortrait: false },
    { slug: "bucephalandra-spp", height: 2.0, forcePortrait: false },
  ],
  mid: [
    { slug: "anubias-barteri-var-nana", height: 2.8, forcePortrait: false },
    { slug: "anubias-barteri", height: 3.2, forcePortrait: false },
    { slug: "cryptocoryne-wendtii", height: 2.6, forcePortrait: false },
    { slug: "bacopa-monnieri", height: 3.0, forcePortrait: false },
    { slug: "ludwigia-repens", height: 3.5, forcePortrait: false },
    { slug: "hygrophila-difformis", height: 3.8, forcePortrait: false },
  ],
  background: [
    { slug: "vallisneria-americana", height: 5.5, forcePortrait: true },
    { slug: "vallisneria-spiralis", height: 5.0, forcePortrait: true },
    { slug: "echinodorus-spp", height: 4.5, forcePortrait: true },
  ],
};

// Deterministic placement.
function seededRand(seed) {
  let s = seed | 0;
  return () => { s = (s * 1664525 + 1013904223) | 0; return (s >>> 0) / 4294967296; };
}

function generatePlacements() {
  const placements = [];
  const rng = seededRand(8675309); // fixed seed

  // Carpet: scattered close to center/front, short, dense clusters.
  for (let i = 0; i < 20; i++) {
    const plant = PLANT_LIB.carpet[i % PLANT_LIB.carpet.length];
    const angle = rng() * Math.PI * 2;
    const dist = 4 + rng() * 20;
    placements.push({
      ...plant,
      x: Math.cos(angle) * dist,
      z: Math.sin(angle) * dist,
      scaleJitter: 0.7 + rng() * 0.5,
      phase: rng() * Math.PI * 2,
    });
  }

  // Midground: medium height, wider spread.
  for (let i = 0; i < 35; i++) {
    const plant = PLANT_LIB.mid[i % PLANT_LIB.mid.length];
    const angle = rng() * Math.PI * 2;
    const dist = 6 + rng() * 30;
    placements.push({
      ...plant,
      x: Math.cos(angle) * dist,
      z: Math.sin(angle) * dist,
      scaleJitter: 0.8 + rng() * 0.5,
      phase: rng() * Math.PI * 2,
    });
  }

  // Background: tall, further out, ring-like behind midground.
  for (let i = 0; i < 25; i++) {
    const plant = PLANT_LIB.background[i % PLANT_LIB.background.length];
    const angle = rng() * Math.PI * 2;
    const dist = 15 + rng() * 35;
    placements.push({
      ...plant,
      x: Math.cos(angle) * dist,
      z: Math.sin(angle) * dist,
      scaleJitter: 0.85 + rng() * 0.4,
      phase: rng() * Math.PI * 2,
    });
  }

  return placements;
}

/** One swaying plant billboard. */
export function PlantInstance({ slug, height, x, z, scaleJitter, phase, forcePortrait = false }) {
  const pivotRef = useRef();  // sway pivot (tilts the stalk from base)
  const billboardRef = useRef(); // yaw-faces camera
  const { camera } = useThree();
  const [texture, setTexture] = useState(null);
  const [aspect, setAspect] = useState(1.0);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.load(`/species-cutouts/${slug}.png`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const img = tex.image;
      if (img?.width && img?.height) {
        let a = img.width / img.height;
        // For tall background plants with landscape source photos, flip to
        // portrait so the plane is tall and narrow (like the real plant grows).
        if (forcePortrait && a > 1.0) a = 1 / a;
        setAspect(a);
      }
      setTexture(tex);
    });
  }, [slug, forcePortrait]);

  // Geometry: plane anchored at base (bottom edge is the pivot).
  const geometry = useMemo(() => {
    const h = height * scaleJitter;
    const w = h * aspect;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(0, h / 2, 0); // pivot at bottom
    return geo;
  }, [height, scaleJitter, aspect]);

  useFrame((state) => {
    if (!pivotRef.current || !billboardRef.current) return;
    const t = state.clock.elapsedTime;

    // Billboard: face camera (yaw only, stay vertical).
    const dx = camera.position.x - x;
    const dz = camera.position.z - z;
    billboardRef.current.rotation.y = Math.atan2(dx, dz);

    // Sway: gentle tilt from base, like a plant in current.
    // Only tilt on X (forward/back lean relative to the billboard face).
    pivotRef.current.rotation.x = Math.sin(t * 0.7 + phase) * 0.04 + Math.sin(t * 1.3 + phase * 0.6) * 0.02;
    pivotRef.current.rotation.z = Math.sin(t * 0.5 + phase * 1.3) * 0.03;
  });

  if (!texture) return null;

  return (
    <group position={[x, FLOOR_Y, z]}>
      {/* Billboard yaw (faces camera) */}
      <group ref={billboardRef}>
        {/* Sway pivot (tilts the stalk) */}
        <group ref={pivotRef}>
          <mesh geometry={geometry}>
            <meshStandardMaterial
              map={texture}
              transparent
              alphaTest={0.2}
              side={THREE.DoubleSide}
              roughness={0.85}
              metalness={0}
              depthWrite={false}
            />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export function PlantedEnvironment() {
  const placements = useMemo(generatePlacements, []);

  return (
    <group>
      {placements.map((p, i) => (
        <PlantInstance key={i} {...p} />
      ))}
    </group>
  );
}
