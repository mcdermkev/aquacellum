import * as THREE from "three";

/**
 * reefEnvMap — a tiny, self-contained image-based-lighting (IBL) environment for
 * the fish materials only.
 *
 * Why: `enhanceFishMaterials` sets `envMapIntensity` on the baked-texture hero
 * models so wet scales catch a subtle sheen. That value does nothing without an
 * environment map to reflect. Rather than pull a multi-megabyte HDRI from a CDN
 * (offline-unfriendly) or set `scene.environment` (which would re-light the sand,
 * plants and props too), we generate a small underwater-toned gradient cubemap
 * once and assign it directly to the fish materials.
 *
 * The map is cached per-renderer so every fish shares one GPU texture.
 */

const cache = new WeakMap();

function buildGradientScene() {
  // A simple vertical gradient: bright teal "surface" up top fading to deep navy
  // below — matches the reef clear color (#0a1628) and caustic palette.
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color("#3fa9c9") },   // sunlit water
      midColor: { value: new THREE.Color("#0e3a55") },   // mid-water blue
      bottomColor: { value: new THREE.Color("#06121f") }, // deep / floor
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldDir;
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      void main() {
        float h = clamp(vWorldDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = h < 0.5
          ? mix(bottomColor, midColor, h * 2.0)
          : mix(midColor, topColor, (h - 0.5) * 2.0);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(geo, mat));
  return scene;
}

/**
 * Returns a cached, prefiltered environment texture suitable for
 * `material.envMap`. Returns null if no renderer is available.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @returns {THREE.Texture|null}
 */
export function getReefEnvMap(renderer) {
  if (!renderer) return null;
  if (cache.has(renderer)) return cache.get(renderer);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const scene = buildGradientScene();
  const envRT = pmrem.fromScene(scene, 0.04);
  const envMap = envRT.texture;

  // Clean up the throwaway gradient scene; keep the prefiltered texture.
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  pmrem.dispose();

  cache.set(renderer, envMap);
  return envMap;
}
