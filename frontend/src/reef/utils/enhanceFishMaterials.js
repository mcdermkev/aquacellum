import * as THREE from "three";

/**
 * enhanceFishMaterials — Normalises the look of TripoSR-generated GLB meshes so
 * they light correctly in the reef, whether they carry a baked texture atlas
 * (the new `--bake-texture` hero models) or legacy vertex colors.
 *
 * Handles three cases per mesh:
 *   1. Baked texture (material.map present): correct sRGB color space,
 *      anisotropic filtering, wet-but-not-metallic PBR, smooth normals.
 *   2. Vertex colors (geometry has a `color` attribute): gamma-lift the colors
 *      and rebuild as a lit MeshStandardMaterial.
 *   3. Untextured: leave a sensible standard material.
 *
 * Safe to call once on a cloned scene. Pass the renderer (optional) to pick the
 * best anisotropy the GPU supports.
 *
 * @param {THREE.Object3D} root         Cloned GLTF scene.
 * @param {object}         [opts]
 * @param {THREE.WebGLRenderer} [opts.renderer]  For max anisotropy lookup.
 * @param {THREE.Texture} [opts.envMap]  Optional IBL map for subtle wet sheen.
 * @param {number} [opts.roughness=0.55]
 * @param {number} [opts.metalness=0.0]
 * @returns {THREE.Object3D} the same root, mutated in place.
 */
export function enhanceFishMaterials(root, opts = {}) {
  const { renderer, envMap = null, roughness = 0.7, metalness = 0.0 } = opts;
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 8;
  const anisotropy = Math.min(8, maxAniso);

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    const geom = child.geometry;
    if (!geom.attributes.normal) geom.computeVertexNormals();

    const existing = child.material;
    const map = existing && existing.map ? existing.map : null;

    if (map) {
      // --- Baked texture atlas (hero models) -------------------------------
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = anisotropy;
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.magFilter = THREE.LinearFilter;
      map.generateMipmaps = true;
      map.needsUpdate = true;

      child.material = new THREE.MeshStandardMaterial({
        map,
        roughness,
        metalness,
        side: THREE.FrontSide,
        // Subtle sheen only — too much reads as crumpled foil on rough meshes.
        envMap,
        envMapIntensity: envMap ? 0.15 : 0,
      });
    } else if (geom.attributes.color) {
      // --- Legacy vertex colors -------------------------------------------
      const colorAttr = geom.attributes.color;
      const arr = colorAttr.array;
      for (let i = 0; i < arr.length; i += colorAttr.itemSize) {
        // Gamma lift: TripoSR vertex colors read dark in linear space.
        arr[i] = Math.pow(arr[i], 0.55);
        arr[i + 1] = Math.pow(arr[i + 1], 0.55);
        arr[i + 2] = Math.pow(arr[i + 2], 0.55);
      }
      colorAttr.needsUpdate = true;

      child.material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.75,
        metalness: 0.0,
        side: THREE.FrontSide,
        envMap,
        envMapIntensity: envMap ? 0.1 : 0,
      });
    } else if (existing) {
      // --- Untextured: keep but tame the response -------------------------
      existing.roughness = roughness;
      existing.metalness = metalness;
      existing.needsUpdate = true;
    }

    child.castShadow = false;
    child.receiveShadow = false;
    if (child.material) child.material.needsUpdate = true;
  });

  return root;
}
