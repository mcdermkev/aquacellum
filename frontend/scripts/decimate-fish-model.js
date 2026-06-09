/**
 * decimate-fish-model.js
 *
 * Reduces polygon count of fish GLB models for real-time rendering.
 * Takes a high-poly GLB (e.g., 2M triangles from Meshy) and outputs
 * a game-ready version (~10k-20k triangles).
 *
 * Usage:
 *   node scripts/decimate-fish-model.js <input.glb> [output.glb] [--target 15000]
 *
 * Examples:
 *   node scripts/decimate-fish-model.js raw/betta-splendens-raw.glb public/models/fish/betta-splendens.glb
 *   node scripts/decimate-fish-model.js raw/betta.glb --target 10000
 *
 * Dependencies:
 *   npm install --save-dev @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer
 *
 * If you don't want to install these, use the Blender CLI alternative below.
 */

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, simplify, dedup, draco } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import path from "path";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
Fish Model Decimator — Reduce GLB polygon count for real-time rendering

Usage:
  node scripts/decimate-fish-model.js <input.glb> [output.glb] [--target N]

Options:
  --target N    Target triangle count (default: 15000)

Examples:
  node scripts/decimate-fish-model.js raw/betta-raw.glb public/models/fish/betta-splendens.glb
  node scripts/decimate-fish-model.js my-fish.glb --target 10000

The output will be optimized for WebGL rendering in the Immersive Reef.
  `);
  process.exit(0);
}

const inputPath = args[0];
let outputPath = null;
let targetTriangles = 15000;

// Parse args
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--target" && args[i + 1]) {
    targetTriangles = parseInt(args[i + 1], 10);
    i++;
  } else if (!args[i].startsWith("--")) {
    outputPath = args[i];
  }
}

if (!outputPath) {
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  outputPath = path.join(path.dirname(inputPath), `${base}-optimized.glb`);
}

async function decimateModel() {
  console.log(`\n🐟 Decimating fish model...`);
  console.log(`   Input:  ${inputPath}`);
  console.log(`   Output: ${outputPath}`);
  console.log(`   Target: ${targetTriangles} triangles\n`);

  await MeshoptSimplifier.ready;

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

  // Read
  const document = await io.read(inputPath);
  const root = document.getRoot();

  // Count original triangles
  let originalTris = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      originalTris += indices ? indices.getCount() / 3 : 0;
    }
  }
  console.log(`   Original: ${originalTris.toLocaleString()} triangles`);

  // Calculate simplification ratio
  const ratio = Math.min(1.0, targetTriangles / originalTris);
  console.log(`   Ratio: ${(ratio * 100).toFixed(2)}%`);

  if (ratio >= 0.95) {
    console.log(`   Already close to target, skipping simplification.`);
  } else {
    // Weld vertices (merge duplicates within tolerance)
    await document.transform(weld({ tolerance: 0.001 }));

    // Simplify meshes
    await document.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 })
    );
  }

  // Deduplicate accessors/textures
  await document.transform(dedup());

  // Count final triangles
  let finalTris = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      finalTris += indices ? indices.getCount() / 3 : 0;
    }
  }
  console.log(`   Final: ${finalTris.toLocaleString()} triangles`);
  console.log(`   Reduction: ${((1 - finalTris / originalTris) * 100).toFixed(1)}%`);

  // Write optimized GLB
  await io.write(outputPath, document);

  const fs = await import("fs");
  const stats = fs.statSync(outputPath);
  console.log(`   File size: ${(stats.size / 1024).toFixed(0)} KB`);
  console.log(`\n✅ Done! Place at: public/models/fish/{species-slug}.glb\n`);
}

decimateModel().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
