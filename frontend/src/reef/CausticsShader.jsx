import React, { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * CausticsProjector — Animated light caustics on the sand floor.
 * Uses a custom shader for the rippling light patterns.
 */

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float caustics(vec2 uv, float time) {
    float c = 0.0;
    c += noise(uv * 4.0 + time * 0.3) * 0.5;
    vec2 uv2 = uv * 6.0 + vec2(time * 0.2, -time * 0.15);
    c += noise(uv2) * 0.3;
    vec2 uv3 = uv * 10.0 + vec2(-time * 0.1, time * 0.25);
    c += noise(uv3) * 0.2;
    return c;
  }

  void main() {
    float c = caustics(vUv, uTime);
    float intensity = smoothstep(0.4, 0.8, c);
    gl_FragColor = vec4(vec3(0.4, 0.8, 1.0), intensity * 0.35);
  }
`;

export function CausticsProjector() {
  const meshRef = useRef();
  const materialRef = useRef();

  // Create the shader material imperatively to avoid R3F uniform issues
  const shaderMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
  }, []);

  useFrame((state) => {
    shaderMat.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.95, 0]} material={shaderMat}>
      <planeGeometry args={[80, 80]} />
    </mesh>
  );
}
