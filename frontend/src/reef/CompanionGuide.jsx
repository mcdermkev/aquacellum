import React, { useRef, useMemo, useState, useEffect, Suspense } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * CompanionGuide — Your Echo companion fish as a 3D guide.
 *
 * Echo now renders as a clean cutout billboard sprite (matching the rest of the
 * reef) instead of a TripoSR GLB. The sprite follows the camera at a comfortable
 * offset, reacts to inspections, scales in smoothly when the tier evolves, and
 * anchors the narration source.
 */

// Map tier to Echo cutout sprite (transparent PNGs in public/).
const TIER_SPRITES = {
  "Bronze": "/echo-fry.png",
  "Silver": "/echo-silver.png",
  "Gold": "/echo-mid.png",
  "Master": "/echo-evolved.png",
  "God-Tier": "/echo-evolved.png",
};

const TIER_CONFIG = {
  "Bronze": { glow: "#cd7f32", scale: 0.9 },
  "Silver": { glow: "#38bdf8", scale: 1.1 },
  "Gold": { glow: "#fbbf24", scale: 1.3 },
  "Master": { glow: "#d500f9", scale: 1.6 },
  "God-Tier": { glow: "#ff6b35", scale: 1.9 },
};

/** Echo as a cutout billboard with swim bob + tier-change scale-in. */
function EchoSprite({ src, scale, mood }) {
  const spriteRef = useRef();
  const { gl } = useThree();
  const [texture, setTexture] = useState(null);
  const [aspect, setAspect] = useState(1.0);
  const transitionRef = useRef(0); // 0 = just switched, 1 = settled
  const phaseRef = useRef(Math.random() * Math.PI * 2);

  // Load the tier cutout; restart the scale-in transition on every tier change.
  useEffect(() => {
    transitionRef.current = 0;
    const loader = new THREE.TextureLoader();
    let cancelled = false;
    loader.load(
      src,
      (tex) => {
        if (cancelled) return;
        tex.colorSpace = THREE.SRGBColorSpace;
        const maxAniso = gl?.capabilities?.getMaxAnisotropy?.() ?? 8;
        tex.anisotropy = Math.min(8, maxAniso);
        const img = tex.image;
        if (img && img.width && img.height) setAspect(img.width / img.height);
        setTexture(tex);
      },
      undefined,
      () => { if (!cancelled) setTexture(null); }
    );
    return () => { cancelled = true; };
  }, [src, gl]);

  useFrame((state, delta) => {
    const sprite = spriteRef.current;
    if (!sprite) return;
    const t = state.clock.elapsedTime;
    const phase = phaseRef.current;

    // Ease the tier-change transition toward settled (1), ease-out-back.
    transitionRef.current = Math.min(1, transitionRef.current + delta * 2.5);
    const q = transitionRef.current - 1;
    const eased = 1 + q * q * ((1.70158 + 1) * q + 1.70158);
    const grow = 0.6 + 0.4 * eased;

    // Gentle breathing/bob so Echo feels alive; a touch livelier when excited.
    const excite = mood === "excited" ? 1.6 : 1.0;
    const bob = 1 + Math.sin(t * 1.6 * excite + phase) * 0.04;

    const base = scale * grow * bob;
    sprite.scale.set(base * aspect, base, 1);
  });

  if (!texture) return null;

  return (
    <sprite ref={spriteRef}>
      <spriteMaterial map={texture} transparent alphaTest={0.2} depthWrite={false} />
    </sprite>
  );
}

/** Fallback glow orb if the Echo cutout fails to load. */
function EchoFallback({ config, mood }) {
  return (
    <mesh scale={config.scale * 0.5}>
      <sphereGeometry args={[0.25, 16, 12]} />
      <meshStandardMaterial
        color={config.glow}
        emissive={config.glow}
        emissiveIntensity={mood === "excited" ? 0.6 : 0.3}
        roughness={0.3}
        metalness={0.2}
      />
    </mesh>
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
  const spriteSrc = TIER_SPRITES[tier] || TIER_SPRITES["Silver"];

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

    // Bob when inspecting
    if (inspectedSpecies) {
      groupRef.current.position.y += Math.sin(time * 4) * 0.008;
    }
  });

  if (!visible) return null;

  return (
    <group ref={groupRef}>
      <Suspense fallback={<EchoFallback config={config} mood={mood} />}>
        <EchoSprite src={spriteSrc} scale={config.scale} mood={mood} />
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
