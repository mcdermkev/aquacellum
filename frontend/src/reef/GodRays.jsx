import React, { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * GodRays — Volumetric light shafts streaming down from the water surface.
 * Creates the classic "sunbeams through water" effect using transparent planes.
 */
export function GodRays({ count = 8 }) {
  const groupRef = useRef();

  const rays = useMemo(() => {
    const items = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist = 3 + Math.random() * 12;
      items.push({
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist,
        width: 0.5 + Math.random() * 1.5,
        height: 12 + Math.random() * 6,
        rotY: Math.random() * Math.PI,
        phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.5,
        baseOpacity: 0.04 + Math.random() * 0.06
      });
    }
    return items;
  }, [count]);

  useFrame((state) => {
    if (!groupRef.current) return;
    const time = state.clock.elapsedTime;

    groupRef.current.children.forEach((child, i) => {
      const ray = rays[i];
      if (!ray || !child.material) return;
      // Gentle opacity oscillation (light flickering through waves)
      const flicker = Math.sin(time * ray.speed + ray.phase) * 0.5 + 0.5;
      child.material.opacity = ray.baseOpacity * (0.5 + flicker * 0.5);
    });
  });

  return (
    <group ref={groupRef}>
      {rays.map((ray, i) => (
        <mesh
          key={i}
          position={[ray.x, 4, ray.z]}
          rotation={[0, ray.rotY, 0]}
        >
          <planeGeometry args={[ray.width, ray.height]} />
          <meshBasicMaterial
            color="#87ceeb"
            transparent
            opacity={ray.baseOpacity}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}
