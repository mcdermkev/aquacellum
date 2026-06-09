# Fish 3D Models

Place GLTF/GLB models here for progressive fidelity fish rendering.

## Naming Convention

Files must match the species slug (scientific name, lowercased, spaces → dashes):
- `betta-splendens.glb`
- `paracheirodon-innesi.glb`
- `corydoras-panda.glb`

## How to Generate Models

### Option 1: AI-generated (recommended for scale)
1. Take the species PNG from `/species-images/{slug}.png`
2. Upload to TRELLIS, Hunyuan3D, or Meshy.ai
3. Export as GLB with <10k triangles
4. Place here with matching filename

### Option 2: Manual (Blender)
1. Model in Blender with simple swim-cycle animation
2. Export as GLB (embedded textures)
3. Keep under 1MB per model

## Animation

If the GLB contains animations, the first clip will auto-play as the swim cycle.
If no animation exists, the system applies procedural oscillation.

## Fallback Chain

The reef viewer uses this priority:
1. `/models/fish/{slug}.glb` — Full 3D model
2. `/species-images/{slug}.png` — Billboard sprite (textured plane)
3. Procedural mesh — Colored ellipsoid (always works)
