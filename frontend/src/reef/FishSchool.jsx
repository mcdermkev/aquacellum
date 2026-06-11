import React, { useRef, useMemo, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SwimmingFishGLB, getSwimParams } from "./ProceduralSwim";
import { isHeroSpecies } from "./heroSpecies";

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

// Substrate sits at y = -3 in the reef scene; keep fish bodies above it.
const FLOOR_Y = -3;
const FISH_CLEARANCE = 0.4;

function getSlug(species) {
  return (species.scientificName || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// Cache GLB availability checks per slug
const glbCache = new Map();
// Cache the resolved sprite URL (cutout preferred, photo fallback) per slug.
const spriteUrlCache = new Map();

// Hero species have baked-texture GLBs, but the TripoSR meshes read worse than
// the clean cutout sprites — so we render everything as cutouts for now. Flip
// this to true to bring the full-3D hero models back.
const USE_HERO_GLB = false;

/** Single fish — checks for GLB first, then sprite, then procedural */
function FishVisual({ species, scale = 1 }) {
  const [renderMode, setRenderMode] = useState("checking"); // checking | glb | sprite | procedural
  const [texture, setTexture] = useState(null);
  const [aspect, setAspect] = useState(1.7); // width / height of the sprite art
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

    // Hero species can render as full-3D GLBs (gated by USE_HERO_GLB); otherwise
    // everything uses clean cutout sprites.
    if (USE_HERO_GLB && isHeroSpecies(slug)) {
      checkGLB();
    } else {
      checkSprite();
    }

    function checkGLB() {
      return fetch(`/models/fish/${slug}.glb`, { method: "HEAD" })
        .then((res) => {
          const ct = res.headers.get("content-type") || "";
          if (res.ok && !ct.includes("text/html")) {
            glbCache.set(slug, "glb");
            setRenderMode("glb");
          } else {
            checkSprite();
          }
        })
        .catch(() => checkSprite());
    }

    // Prefer a transparent cutout; fall back to the original (opaque) photo.
    function resolveSpriteUrl() {
      if (spriteUrlCache.has(slug)) return Promise.resolve(spriteUrlCache.get(slug));
      const cutout = `/species-cutouts/${slug}.png`;
      const photo = `/species-images/${slug}.png`;
      const ok = (res) => res.ok && !(res.headers.get("content-type") || "").includes("text/html");
      return fetch(cutout, { method: "HEAD" })
        .then((res) => {
          const url = ok(res) ? cutout : photo;
          return fetch(url, { method: "HEAD" }).then((r2) => (ok(r2) ? url : null));
        })
        .catch(() =>
          fetch(photo, { method: "HEAD" })
            .then((r) => (ok(r) ? photo : null))
            .catch(() => null)
        )
        .then((url) => {
          spriteUrlCache.set(slug, url);
          return url;
        });
    }

    function checkSprite() {
      return resolveSpriteUrl().then((url) => {
        if (url) {
          glbCache.set(slug, "sprite");
          setRenderMode("sprite");
          loadTexture();
        } else {
          glbCache.set(slug, "procedural");
          setRenderMode("procedural");
        }
      });
    }
  }, [slug]);

  function loadTexture() {
    const url = spriteUrlCache.get(slug) || `/species-images/${slug}.png`;
    const loader = new THREE.TextureLoader();
    loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const img = tex.image;
      if (img && img.width && img.height) setAspect(img.width / img.height);
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

  // Sprite mode: billboard sized to the art's real aspect ratio (no stretch).
  if (renderMode === "sprite" && texture) {
    const width = scale * 0.9;
    const height = width / (aspect || 1.7);
    return (
      <sprite scale={[width, height, 1]}>
        <spriteMaterial map={texture} transparent alphaTest={0.2} depthWrite={false} />
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
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 4
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

      // Hard floor: never let a fish sink below the substrate (world space).
      // world Y = group base (position[1]) + local fish.pos.y
      const minLocalY = (FLOOR_Y + FISH_CLEARANCE) - position[1];
      if (fish.pos.y < minLocalY) {
        fish.pos.y = minLocalY;
        if (fish.vel.y < 0) fish.vel.y = 0;
      }

      // Bounds: keep within a 6-unit sphere (wider so the school drifts)
      if (fish.pos.length() > 6) {
        fish.vel.add(fish.pos.clone().negate().multiplyScalar(0.003));
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
