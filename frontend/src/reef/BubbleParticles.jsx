import React, { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * BubbleParticles — Rising air bubbles scattered through the reef.
 */
export function BubbleParticles({ count = 80 }) {
  const meshRef = useRef();

  const data = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const phases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 1] = -3 + Math.random() * 15;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
      speeds[i] = 0.01 + Math.random() * 0.03;
      phases[i] = Math.random() * Math.PI * 2;
    }

    return { positions, speeds, phases };
  }, [count]);

  useEffect(() => {
    if (!meshRef.current) return;
    const geo = meshRef.current.geometry;
    geo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  }, [data]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const posAttr = meshRef.current.geometry.attributes.position;
    if (!posAttr) return;
    const time = state.clock.elapsedTime;

    for (let i = 0; i < count; i++) {
      posAttr.array[i * 3 + 1] += data.speeds[i];
      posAttr.array[i * 3] += Math.sin(time * 2 + data.phases[i]) * 0.003;
      posAttr.array[i * 3 + 2] += Math.cos(time * 1.5 + data.phases[i]) * 0.002;

      if (posAttr.array[i * 3 + 1] > 14) {
        posAttr.array[i * 3 + 1] = -3;
        posAttr.array[i * 3] = (Math.random() - 0.5) * 40;
        posAttr.array[i * 3 + 2] = (Math.random() - 0.5) * 40;
      }
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry />
      <pointsMaterial size={0.08} color="#ffffff" transparent opacity={0.4} sizeAttenuation />
    </points>
  );
}
