import React, { useRef, useMemo } from "react";
import { useFrame, useThree, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { GodRays } from "./GodRays";
import { BubbleParticles } from "./BubbleParticles";
import { CausticsProjector } from "./CausticsShader";
import { PlantInstance } from "./PlantedEnvironment";

/**
 * GenerativeReef — six distinct FRESHWATER biomes, each a real aquascape style
 * with its own palette, hardscape, planting, particle life, and a signature
 * delight. No saltwater — coral/reef stays out per our standard.
 *
 * Biomes:
 *   amazon_blackwater — tannin-dark, driftwood tangles, leaf litter, dim amber
 *   dutch_planted     — lush colorful jungle, pearling oxygen bubbles
 *   asian_stream      — smooth pebbles, clear cool water, gentle current
 *   rift_lake         — bright blue, sandy floor, stacked rock piles
 *   iwagumi           — minimalist: arranged stones, carpet, lots of space
 *   crystal_spring    — gin-clear turquoise, white limestone, brilliant rays
 */

const FLOOR_Y = -3;

// Generated biome assets live at /biomes/{biomeType}/{floor,backdrop}.png
// (produced by frontend/scripts/imagen_generate.py). Both fall back gracefully:
// floor -> flat biome color, backdrop -> nothing, so the scene still renders if
// an asset is missing.
const FLOOR_TEXTURE_TILE = 5;

/** Substrate plane textured with the generated biome floor; flat color fallback. */
export function BiomeFloor({ biomeType }) {
  const tex = useLoader(THREE.TextureLoader, `/biomes/${biomeType}/floor.png`);
  useMemo(() => {
    if (!tex) return;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(FLOOR_TEXTURE_TILE, FLOOR_TEXTURE_TILE);
    tex.anisotropy = 8;
    tex.needsUpdate = true;
  }, [tex]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
      <planeGeometry args={[160, 160, 16, 16]} />
      <meshStandardMaterial map={tex} roughness={0.95} metalness={0} />
    </mesh>
  );
}

/** Far underwater backdrop: the generated 16:9 scene wrapped around the horizon. */
export function BiomeBackdrop({ biomeType }) {
  const tex = useLoader(THREE.TextureLoader, `/biomes/${biomeType}/backdrop.png`);
  useMemo(() => {
    if (!tex) return;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(3, 1); // wrap the 16:9 scene around the cylinder
    tex.needsUpdate = true;
  }, [tex]);

  return (
    <mesh position={[0, FLOOR_Y + 16, 0]} renderOrder={-10}>
      {/* open-ended cylinder, textured on the inside (BackSide) */}
      <cylinderGeometry args={[72, 72, 44, 64, 1, true]} />
      <meshBasicMaterial map={tex} side={THREE.BackSide} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

const BIOME_TEMPLATES = {
  amazon_blackwater: {
    label: "Amazon Blackwater",
    emoji: "🌑",
    clearColor: "#1a1206",
    floorColor: "#2a1c0e",
    fog: ["#3a2410", 8, 42],
    ambient: { color: "#c79a4a", intensity: 0.5 },
    sun: { color: "#e0a850", intensity: 0.7, pos: [6, 20, 4] },
    rocks: { count: 6, palette: ["#3a2a1a", "#2d2012", "#4a3520"], flat: true, sizeMin: 0.5, sizeMax: 1.8 },
    driftwood: 22,
    plants: { slugs: ["echinodorus-spp", "cryptocoryne-wendtii"], count: 16, distMin: 5, distMax: 34, hMin: 2.5, hMax: 4.5 },
    particles: { color: "#a8895a", count: 500, drift: "fall" },
    godRays: 6,
    bubbles: 0,
    leafLitter: true,
  },
  dutch_planted: {
    label: "Dutch Planted",
    emoji: "🌿",
    clearColor: "#0c1f12",
    floorColor: "#3a2a18",
    fog: ["#15403a", 20, 90],
    ambient: { color: "#d8f0d0", intensity: 0.8 },
    sun: { color: "#fff5e0", intensity: 1.1, pos: [8, 26, 6] },
    rocks: { count: 4, palette: ["#5a6a72", "#4a5a60"], flat: true, sizeMin: 0.4, sizeMax: 1.0 },
    driftwood: 6,
    plants: {
      slugs: ["ludwigia-repens", "hygrophila-difformis", "bacopa-monnieri", "cryptocoryne-wendtii",
              "anubias-barteri", "vallisneria-americana", "echinodorus-spp"],
      count: 110, distMin: 3, distMax: 40, hMin: 1.8, hMax: 5.0, layered: true,
    },
    particles: { color: "#d0ffe0", count: 400, drift: "rise" },
    godRays: 10,
    bubbles: 140, // pearling
    leafLitter: false,
  },
  asian_stream: {
    label: "Asian Stream",
    emoji: "🏞️",
    clearColor: "#0a1c1f",
    floorColor: "#6a6258",
    fog: ["#1a5060", 18, 80],
    ambient: { color: "#d0eef5", intensity: 0.75 },
    sun: { color: "#e8f4ff", intensity: 1.0, pos: [-6, 24, 8] },
    rocks: { count: 26, palette: ["#7a756a", "#6a6258", "#8a857a", "#5a564c"], flat: false, sizeMin: 0.4, sizeMax: 1.6 },
    driftwood: 8,
    plants: { slugs: ["vallisneria-spiralis", "cryptocoryne-parva", "anubias-barteri-var-nana"], count: 30, distMin: 5, distMax: 36, hMin: 2.0, hMax: 4.5 },
    particles: { color: "#bfe8ff", count: 600, drift: "flow" },
    godRays: 8,
    bubbles: 40,
    leafLitter: false,
  },
  rift_lake: {
    label: "African Rift Lake",
    emoji: "🪨",
    clearColor: "#06243a",
    floorColor: "#d8c9a0",
    fog: ["#1a6faa", 24, 100],
    ambient: { color: "#cfe6ff", intensity: 0.85 },
    sun: { color: "#ffffff", intensity: 1.2, pos: [10, 28, 5] },
    rocks: { count: 40, palette: ["#b89a6a", "#9a7d52", "#caa873", "#876a44"], flat: true, sizeMin: 0.6, sizeMax: 2.6, piles: true },
    driftwood: 0,
    plants: { slugs: ["vallisneria-americana"], count: 8, distMin: 20, distMax: 42, hMin: 3.0, hMax: 5.0 },
    particles: { color: "#dff0ff", count: 300, drift: "rise" },
    godRays: 9,
    bubbles: 30,
    leafLitter: false,
  },
  iwagumi: {
    label: "Iwagumi Stone Garden",
    emoji: "⛩️",
    clearColor: "#0a2024",
    floorColor: "#e0d8c4",
    fog: ["#2a6a7a", 26, 105],
    ambient: { color: "#fff5ec", intensity: 0.9 },
    sun: { color: "#fff8f0", intensity: 1.15, pos: [4, 30, 10] },
    rocks: { count: 7, palette: ["#5a6a72", "#4a5a60", "#6a7a82"], flat: true, sizeMin: 1.0, sizeMax: 3.0, arranged: true },
    driftwood: 0,
    plants: { slugs: ["cryptocoryne-parva", "bucephalandra-spp"], count: 70, distMin: 3, distMax: 22, hMin: 1.2, hMax: 2.0, carpet: true },
    particles: { color: "#eaffff", count: 250, drift: "rise" },
    godRays: 7,
    bubbles: 50,
    leafLitter: false,
  },
  crystal_spring: {
    label: "Crystal Spring",
    emoji: "💎",
    clearColor: "#0a3038",
    floorColor: "#e8ecec",
    fog: ["#2aa8c0", 30, 120],
    ambient: { color: "#eafcff", intensity: 0.95 },
    sun: { color: "#ffffff", intensity: 1.3, pos: [6, 32, 6] },
    rocks: { count: 14, palette: ["#cfd6d6", "#b8c0c0", "#dfe6e6"], flat: false, sizeMin: 0.5, sizeMax: 2.0 },
    driftwood: 4,
    plants: { slugs: ["vallisneria-spiralis", "vallisneria-americana"], count: 22, distMin: 8, distMax: 40, hMin: 3.5, hMax: 5.5 },
    particles: { color: "#ffffff", count: 350, drift: "rise" },
    godRays: 12,
    bubbles: 60,
    leafLitter: false,
  },
};

function seededRand(seed) {
  let s = seed | 0;
  return () => { s = (s * 1664525 + 1013904223) | 0; return (s >>> 0) / 4294967296; };
}

const PORTRAIT_SLUGS = new Set([
  "vallisneria-americana", "vallisneria-spiralis", "echinodorus-spp",
]);

export function GenerativeReef({ biomeType = "dutch_planted", seed = 42, radius = 20 }) {
  const t = BIOME_TEMPLATES[biomeType] || BIOME_TEMPLATES.dutch_planted;
  const { scene, gl } = useThree();

  React.useEffect(() => {
    scene.fog = new THREE.Fog(t.fog[0], t.fog[1], t.fog[2]);
    const prev = gl.getClearColor(new THREE.Color()).getHexString();
    gl.setClearColor(t.clearColor);
    return () => { scene.fog = null; gl.setClearColor("#" + prev); };
  }, [scene, gl, t]);

  // ---- Hardscape: rocks ----
  const rocks = useMemo(() => {
    const rng = seededRand(seed + 11);
    const items = [];
    const R = t.rocks;
    for (let i = 0; i < R.count; i++) {
      let x, z;
      if (R.arranged) {
        // Iwagumi: cluster around a golden-ratio main stone with negative space.
        const main = i === 0;
        const a = i * 2.399963;
        const d = main ? 0 : 4 + rng() * 10;
        x = Math.cos(a) * d + (main ? -3 : 0);
        z = Math.sin(a) * d;
      } else if (R.piles) {
        // Rift lake: clustered piles.
        const cluster = Math.floor(rng() * 5);
        const ca = cluster * 1.6;
        const cd = 8 + cluster * 6;
        x = Math.cos(ca) * cd + (rng() - 0.5) * 6;
        z = Math.sin(ca) * cd + (rng() - 0.5) * 6;
      } else {
        const a = rng() * Math.PI * 2;
        const d = 4 + rng() * (radius * 1.6);
        x = Math.cos(a) * d;
        z = Math.sin(a) * d;
      }
      const sx = R.sizeMin + rng() * (R.sizeMax - R.sizeMin);
      items.push({
        position: [x, FLOOR_Y + (R.piles ? rng() * 1.5 : rng() * 0.6), z],
        scale: [sx, sx * (0.6 + rng() * 0.7), sx * (0.8 + rng() * 0.4)],
        rotation: [rng() * 0.4, rng() * Math.PI, rng() * 0.3],
        color: R.palette[i % R.palette.length],
        flat: R.flat,
      });
    }
    return items;
  }, [t, seed, radius]);

  // ---- Driftwood ----
  const logs = useMemo(() => {
    const rng = seededRand(seed + 23);
    const items = [];
    for (let i = 0; i < t.driftwood; i++) {
      const a = rng() * Math.PI * 2;
      const d = 3 + rng() * (radius * 1.5);
      items.push({
        position: [Math.cos(a) * d, FLOOR_Y + rng() * 0.4, Math.sin(a) * d],
        rotation: [rng() * 0.5, rng() * Math.PI, rng() * 0.6],
        length: 1.5 + rng() * 4.5,
        radius: 0.06 + rng() * 0.16,
      });
    }
    return items;
  }, [t, seed, radius]);

  // ---- Plants (real cutouts) ----
  const plants = useMemo(() => {
    const P = t.plants;
    if (!P || P.count === 0) return [];
    const rng = seededRand(seed + 37);
    const items = [];
    for (let i = 0; i < P.count; i++) {
      const slug = P.slugs[i % P.slugs.length];
      const a = rng() * Math.PI * 2;
      let d;
      if (P.carpet) d = P.distMin + rng() * (P.distMax - P.distMin);
      else if (P.layered) {
        // bias: small near, tall far
        d = P.distMin + Math.pow(rng(), 0.7) * (P.distMax - P.distMin);
      } else d = P.distMin + rng() * (P.distMax - P.distMin);
      items.push({
        slug,
        x: Math.cos(a) * d,
        z: Math.sin(a) * d,
        height: P.hMin + rng() * (P.hMax - P.hMin),
        scaleJitter: 0.75 + rng() * 0.5,
        phase: rng() * Math.PI * 2,
        forcePortrait: PORTRAIT_SLUGS.has(slug),
      });
    }
    return items;
  }, [t, seed]);

  return (
    <group>
      {/* Lighting */}
      <ambientLight intensity={t.ambient.intensity} color={t.ambient.color} />
      <directionalLight position={t.sun.pos} intensity={t.sun.intensity} color={t.sun.color} />
      <hemisphereLight skyColor={t.sun.color} groundColor={t.floorColor} intensity={0.4} />

      {/* Far underwater backdrop (generated biome scene) */}
      <BiomeBackdrop biomeType={biomeType} />

      {/* Floor — generated substrate texture, falls back to flat biome color */}
      <BiomeFloor biomeType={biomeType} fallbackColor={t.floorColor} />

      {/* God rays + caustics */}
      <GodRays count={t.godRays} />
      <CausticsProjector />

      {/* Rocks */}
      {rocks.map((r, i) => (
        <mesh key={`rock-${i}`} position={r.position} rotation={r.rotation} scale={r.scale}>
          <dodecahedronGeometry args={[1, r.flat ? 0 : 1]} />
          <meshStandardMaterial color={r.color} roughness={0.9} metalness={0.05} flatShading={r.flat} />
        </mesh>
      ))}

      {/* Driftwood */}
      {logs.map((log, i) => (
        <mesh key={`log-${i}`} position={log.position} rotation={log.rotation}>
          <cylinderGeometry args={[log.radius, log.radius * 1.3, log.length, 7]} />
          <meshStandardMaterial color="#3f2c18" roughness={0.95} />
        </mesh>
      ))}

      {/* Real plant cutouts */}
      {plants.map((p, i) => (
        <PlantInstance key={`plant-${i}`} {...p} />
      ))}

      {/* Leaf litter (blackwater) */}
      {t.leafLitter && <LeafLitter seed={seed} radius={radius} />}

      {/* Pearling / bubbles */}
      {t.bubbles > 0 && <BubbleParticles count={t.bubbles} />}

      {/* Drifting particles */}
      <BiomeParticles count={t.particles.count} color={t.particles.color} drift={t.particles.drift} radius={radius} />
    </group>
  );
}

/** Scattered leaf shapes resting on the substrate (Amazon blackwater). */
function LeafLitter({ seed, radius }) {
  const leaves = useMemo(() => {
    const rng = seededRand(seed + 71);
    const arr = [];
    const colors = ["#6e4a22", "#5a3a18", "#7a5226", "#4a3014"];
    for (let i = 0; i < 60; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * radius * 1.6;
      arr.push({
        position: [Math.cos(a) * d, FLOOR_Y + 0.05, Math.sin(a) * d],
        rotation: rng() * Math.PI,
        scale: 0.3 + rng() * 0.7,
        color: colors[i % colors.length],
      });
    }
    return arr;
  }, [seed, radius]);
  return (
    <group>
      {leaves.map((l, i) => (
        <mesh key={i} position={l.position} rotation={[-Math.PI / 2, 0, l.rotation]} scale={l.scale}>
          <circleGeometry args={[0.5, 6]} />
          <meshStandardMaterial color={l.color} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/** Drifting motes: rise (bubbles/oxygen), fall (detritus), or flow (current). */
function BiomeParticles({ count, color, drift, radius }) {
  const ref = useRef();
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * radius * 3;
      arr[i * 3 + 1] = FLOOR_Y + Math.random() * 16;
      arr[i * 3 + 2] = (Math.random() - 0.5) * radius * 3;
    }
    return arr;
  }, [count, radius]);

  useFrame((state) => {
    if (!ref.current) return;
    const pos = ref.current.geometry.attributes.position;
    if (!pos) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      if (drift === "rise") {
        pos.array[i * 3 + 1] += 0.004;
        pos.array[i * 3] += Math.sin(t + i) * 0.0006;
        if (pos.array[i * 3 + 1] > 14) pos.array[i * 3 + 1] = FLOOR_Y;
      } else if (drift === "fall") {
        pos.array[i * 3 + 1] -= 0.0015;
        pos.array[i * 3] += Math.sin(t * 0.4 + i) * 0.0008;
        if (pos.array[i * 3 + 1] < FLOOR_Y) pos.array[i * 3 + 1] = 14;
      } else { // flow
        pos.array[i * 3] += 0.01;
        pos.array[i * 3 + 1] += Math.sin(t * 0.6 + i) * 0.0004;
        if (pos.array[i * 3] > radius * 1.5) pos.array[i * 3] = -radius * 1.5;
      }
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={drift === "rise" ? 0.05 : 0.035} color={color} transparent opacity={0.5} sizeAttenuation />
    </points>
  );
}

/**
 * BiomeSelector — choose a freshwater biome. Shows label + emoji.
 */
export function BiomeSelector({ currentBiome, onSelect }) {
  const biomes = Object.keys(BIOME_TEMPLATES);
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 280 }}>
      {biomes.map((biome) => {
        const tpl = BIOME_TEMPLATES[biome];
        const active = currentBiome === biome;
        return (
          <button
            key={biome}
            onClick={() => onSelect(biome)}
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              border: `1px solid ${active ? "#38bdf8" : "#334155"}`,
              background: active ? "rgba(56, 189, 248, 0.15)" : "rgba(15, 23, 42, 0.6)",
              color: active ? "#38bdf8" : "#cbd5e1",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {tpl.emoji} {tpl.label}
          </button>
        );
      })}
    </div>
  );
}
