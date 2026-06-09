import React, { useRef, useEffect, useState, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * GaussianSplatViewer — Loads and renders Gaussian Splat (.splat) files
 * for photorealistic captured environments (real aquariums, reef sections).
 *
 * Splat files can be generated from video/photos using tools like:
 * - Luma AI (phone app → export .splat)
 * - Nerfstudio (nerfstudio.github.io)
 * - gsplat.js (web-based training)
 *
 * Place .splat files in public/splats/ and reference by name.
 *
 * Format: Each splat point = position(3) + scale(3) + rotation(4) + color(4)
 * = 14 floats = 56 bytes per splat
 *
 * This is a simplified viewer — for production, consider using
 * @mkkellogg/gaussian-splats-3d or gsplat.js for full sorting/rendering.
 */

export function GaussianSplatViewer({
  src,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  opacity = 1.0,
  visible = true
}) {
  const pointsRef = useRef();
  const [splatData, setSplatData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load splat file
  useEffect(() => {
    if (!src) return;
    setLoading(true);
    setError(null);

    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load splat: ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buffer) => {
        const data = parseSplatBuffer(buffer);
        setSplatData(data);
        setLoading(false);
      })
      .catch((err) => {
        console.warn("[GaussianSplatViewer] Load error:", err.message);
        setError(err.message);
        setLoading(false);
      });
  }, [src]);

  if (!visible || loading || error || !splatData) return null;

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={splatData.count}
            array={splatData.positions}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-color"
            count={splatData.count}
            array={splatData.colors}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.02 * scale}
          vertexColors
          transparent
          opacity={opacity}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

/**
 * Parse a .splat binary buffer into positions and colors.
 * Standard .splat format: 32 bytes per point
 * - x, y, z (3 × float32 = 12 bytes)
 * - scale_x, scale_y, scale_z (3 × float32 = 12 bytes) [ignored for point rendering]
 * - r, g, b, a (4 × uint8 = 4 bytes)
 * - qw, qx, qy, qz (4 × uint8 = 4 bytes) [ignored for point rendering]
 * Total: 32 bytes per splat
 */
function parseSplatBuffer(buffer) {
  const bytesPerSplat = 32;
  const count = Math.floor(buffer.byteLength / bytesPerSplat);

  if (count === 0) {
    return { count: 0, positions: new Float32Array(0), colors: new Float32Array(0) };
  }

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const view = new DataView(buffer);

  for (let i = 0; i < count; i++) {
    const offset = i * bytesPerSplat;

    // Position
    positions[i * 3] = view.getFloat32(offset, true);
    positions[i * 3 + 1] = view.getFloat32(offset + 4, true);
    positions[i * 3 + 2] = view.getFloat32(offset + 8, true);

    // Color (after 24 bytes of position + scale)
    colors[i * 3] = view.getUint8(offset + 24) / 255;
    colors[i * 3 + 1] = view.getUint8(offset + 25) / 255;
    colors[i * 3 + 2] = view.getUint8(offset + 26) / 255;
  }

  return { count, positions, colors };
}

/**
 * SplatEnvironment — Wrapper to load a splat as a reef background environment.
 * Usage: Place a .splat file in public/splats/reef-capture.splat
 */
export function SplatEnvironment({ name = "reef-capture", ...props }) {
  const src = `/splats/${name}.splat`;
  return <GaussianSplatViewer src={src} {...props} />;
}

/**
 * SplatLoadingIndicator — Shows while a splat is being fetched.
 * Can be placed in a React Suspense boundary.
 */
export function SplatLoadingIndicator({ position = [0, 2, 0] }) {
  const meshRef = useRef();

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 2;
    }
  });

  return (
    <mesh ref={meshRef} position={position}>
      <octahedronGeometry args={[0.3, 0]} />
      <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.5} />
    </mesh>
  );
}
