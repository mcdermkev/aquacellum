import React, { useRef, useMemo, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SwimmingFishGLB, getSwimParams } from "./ProceduralSwim";

/**
 * FishSchool — A group of fish (single species) swimming with boid-like behavior.
 *
 * Progressive fidelity per fish:
 * 1. GLB model + procedural swim (if /models/fish/{slug}.glb exists)
 * 2. Species PNG billboard sprite (if /species-images/{slug}.png exists)
 * 3. Colored procedural mesh (fallback)
 */

// Color palette by family (fallback)
const FAMILY_COLORS = {
  cichlidae: "#f59e0b",
  characidae: "#ef4444",
  poeciliidae: "#22c55e",
  loricariidae: "#78716c",
  callichthyidae: "#a78bfa",
  osphronemidae: "#3b82f6",
  cyprinidae: "#06b6d4",
  default: "#64748b"
};

function getFishColor(species) {
  const family = (species.family || "").toLowerCase();
  return FAMILY_COLORS[family] || FAMILY_COLORS.default;
}

function getSlug(species) {
  return (species.scientificName || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// Cache GLB availability checks per slug
const glbCache = new Map();

/** Single fish — checks for GLB first, then sprite, then procedural */
function FishVisual({ species, scale = 1 }) {
  const [renderMode, setRenderMode] = useState("checking"); // checking | glb | sprite | procedural
  const [texture, setTexture] = useState(null);
  const slug = getSlug(species);
  const color = getFishColor(species);

  useEffect(() => {
    if (!slug) { setRenderMode("procedural"); return; }

    // Check cache
    if (glbCache.has(slug)) {
      setRenderMode(glbCache.get(slug));
      if (glbCache.get(slug) === "sprite") loadTexture();
      return;
    }

    // Prefer sprites (look much better than TripoSR blob meshes)
    checkSprite();

    function checkSprite() {
      return fetch(`/species-images/${slug}.png`, { method: "HEAD" })
        .then((res) => {
          const ct = res.headers.get("content-type") || "";
          if (res.ok && !ct.includes("text/html")) {
            glbCache.set(slug, "sprite");
            setRenderMode("sprite");
            loadTexture();
          } else {
            glbCache.set(slug, "procedural");
            setRenderMode("procedural");
          }
        })
        .catch(() => {
          glbCache.set(slug, "procedural");
          setRenderMode("procedural");
        });
    }
  }, [slug]);

  function loadTexture() {
    const loader = new THREE.TextureLoader();
    loader.load(`/species-images/${slug}.png`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      setTexture(tex);
    }, undefined, () => setTexture(null));
  }

  if (renderMode === "checking") return null;

  // GLB mode: full 3D with procedural swim
  if (renderMode === "glb") {
    const { swimSpeed, swimAmplitude, modelScale } = getSwimParams(species);
    return (
      <SwimmingFishGLB
        src={`/models/fish/${slug}.glb`}
        scale={scale * modelScale}
        swimSpeed={swimSpeed}
        swimAmplitude={swimAmplitude}
      />
    );
  }

  // Sprite mode: billboard
  if (renderMode === "sprite" && texture) {
    const width = scale * 0.6;
    const height = scale * 0.35;
    return (
      <sprite scale={[width, height, 1]}>
        <spriteMaterial map={texture} transparent alphaTest={0.05} />
      </sprite>
    );
  }

  // Procedural fallback
  return (
    <group scale={scale * 0.8}>
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

export function FishSchool({ species, count, position, onInspect }) {
  const groupRef = useRef();
  const fishRefs = useRef([]);

  // Initialize individual fish positions and velocities
  const fishData = useMemo(() => {
    const data = [];
    for (let i = 0; i < count; i++) {
      data.push({
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 1,
          (Math.random() - 0.5) * 2
        ),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 0.006,
          (Math.random() - 0.5) * 0.002,
          (Math.random() - 0.5) * 0.006
        ),
        phase: Math.random() * Math.PI * 2
      });
    }
    return data;
  }, [count]);

  // Size based on maxLengthCm (clamped for scene scale)
  const fishScale = useMemo(() => {
    const cm = species.maxLengthCm || 5;
    return Math.max(0.4, Math.min(1.8, cm / 8));
  }, [species.maxLengthCm]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;

    fishData.forEach((fish, i) => {
      // Simple boid: drift forward + oscillate + stay near center
      const centerPull = fish.pos.clone().negate().multiplyScalar(0.001);
      fish.vel.add(centerPull);

      // Gentle random steering
      if (Math.random() < 0.02) {
        fish.vel.x += (Math.random() - 0.5) * 0.0015;
        fish.vel.z += (Math.random() - 0.5) * 0.0015;
      }

      // Clamp speed
      fish.vel.clampLength(0, 0.008);

      // Update position
      fish.pos.add(fish.vel);

      // Vertical swim oscillation
      const yOsc = Math.sin(time * 1.5 + fish.phase) * 0.002;
      fish.pos.y += yOsc;

      // Keep fish at a reasonable depth (between -2 and 5)
      if (fish.pos.y > 5) fish.vel.y -= 0.001;
      if (fish.pos.y < -2) fish.vel.y += 0.001;
      fish.vel.y *= 0.95; // dampen vertical movement

      // Bounds: keep within a 4-unit sphere
      if (fish.pos.length() > 4) {
        fish.vel.add(fish.pos.clone().negate().multiplyScalar(0.005));
      }

      // Apply to mesh
      const ref = fishRefs.current[i];
      if (ref) {
        ref.position.copy(fish.pos);

        // Face direction of movement
        if (fish.vel.lengthSq() > 0.00001) {
          const angle = Math.atan2(fish.vel.x, fish.vel.z);
          ref.rotation.y = angle;
        }

        // Subtle body wiggle
        ref.rotation.z = Math.sin(time * 4 + fish.phase) * 0.1;
      }
    });
  });

  return (
    <group ref={groupRef} position={position}>
      {fishData.map((_, i) => (
        <group
          key={i}
          ref={(el) => { fishRefs.current[i] = el; }}
          onClick={(e) => {
            e.stopPropagation();
            onInspect();
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "default";
          }}
        >
          <FishVisual species={species} scale={fishScale} />
        </group>
      ))}
    </group>
  );
}
