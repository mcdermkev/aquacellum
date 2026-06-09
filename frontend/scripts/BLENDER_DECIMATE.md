# Alternative: Decimate with Blender (no Node dependencies needed)

If you don't want to install the gltf-transform packages, Blender can do the same
thing via command line. This is often easier for one-off models.

## GUI method (visual)

1. Open Blender
2. File → Import → glTF 2.0 (.glb)
3. Select your mesh in the viewport
4. Properties panel → Modifiers (wrench icon) → Add Modifier → Decimate
5. Set Ratio to achieve ~10k-20k faces (e.g., for 2M faces, ratio = 0.008)
6. Click Apply
7. File → Export → glTF 2.0 (.glb)
8. Name it `{species-slug}.glb` and save to `frontend/public/models/fish/`

## CLI method (batch)

```bash
blender --background --python decimate_batch.py -- input_folder/ output_folder/ 15000
```

Create `decimate_batch.py`:

```python
import bpy
import sys
import os
from pathlib import Path

argv = sys.argv[sys.argv.index("--") + 1:]
input_dir = Path(argv[0])
output_dir = Path(argv[1])
target_faces = int(argv[2]) if len(argv) > 2 else 15000

output_dir.mkdir(parents=True, exist_ok=True)

for glb_file in input_dir.glob("*.glb"):
    # Clear scene
    bpy.ops.wm.read_factory_settings(use_empty=True)
    
    # Import
    bpy.ops.import_scene.gltf(filepath=str(glb_file))
    
    # Get mesh objects
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            bpy.context.view_layer.objects.active = obj
            
            # Calculate ratio
            current_faces = len(obj.data.polygons)
            if current_faces > target_faces:
                ratio = target_faces / current_faces
                
                # Add decimate modifier
                mod = obj.modifiers.new("Decimate", 'DECIMATE')
                mod.ratio = ratio
                bpy.ops.object.modifier_apply(modifier="Decimate")
            
            print(f"  {glb_file.name}: {current_faces} → {len(obj.data.polygons)} faces")
    
    # Export
    output_path = output_dir / glb_file.name
    bpy.ops.export_scene.gltf(filepath=str(output_path), export_format='GLB')
    print(f"  → {output_path}")

print("Done!")
```

## Quick single-file Blender command

```bash
blender --background --python-expr "
import bpy
bpy.ops.import_scene.gltf(filepath='my-fish-raw.glb')
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        bpy.context.view_layer.objects.active = obj
        ratio = 15000 / max(len(obj.data.polygons), 1)
        mod = obj.modifiers.new('Dec', 'DECIMATE')
        mod.ratio = min(ratio, 1.0)
        bpy.ops.object.modifier_apply(modifier='Dec')
bpy.ops.export_scene.gltf(filepath='my-fish.glb', export_format='GLB')
"
```

## Recommended triangle counts

| Use case | Triangles | File size |
|----------|-----------|-----------|
| Hero fish (close-up) | 20,000-30,000 | 200-500 KB |
| Standard fish (schools) | 8,000-15,000 | 80-200 KB |
| Distant/tiny fish | 3,000-5,000 | 30-80 KB |
| Tank objects (rocks, wood) | 5,000-20,000 | 50-300 KB |
