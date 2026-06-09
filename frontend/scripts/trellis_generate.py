"""
TripoSR Batch Fish Model Generator
====================================
Generates GLB 3D models from species PNG images using TripoSR on local GPU.
TripoSR runs in ~2 seconds per fish on RTX 5080 with no compatibility issues.

Usage (from fish-dex-protocol/frontend/scripts/):
  conda activate trellis
  python trellis_generate.py --batch 10
  python trellis_generate.py --species betta-splendens
  python trellis_generate.py --all

Requirements:
  - NVIDIA RTX 5080 (or any GPU with 6GB+ VRAM)
  - PyTorch 2.11+ with CUDA 12.8
  - TripoSR cloned to ~/TripoSR
"""

import sys
import os
import argparse
import time
from pathlib import Path

# Add TripoSR to path
TRIPOSR_DIR = Path.home() / "TripoSR"
sys.path.insert(0, str(TRIPOSR_DIR))

# Disable xformers (not compatible with RTX 5080 sm_120)
os.environ["XFORMERS_DISABLED"] = "1"

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
SPECIES_IMAGES_DIR = PROJECT_ROOT / "public" / "species-images"
OUTPUT_DIR = PROJECT_ROOT / "public" / "models" / "fish"


def get_all_species():
    """Get list of all species PNGs available."""
    pngs = sorted(SPECIES_IMAGES_DIR.glob("*.png"))
    return pngs


def get_pending_species(all_pngs):
    """Filter to only species that don't have a GLB yet."""
    pending = []
    for png in all_pngs:
        glb_path = OUTPUT_DIR / f"{png.stem}.glb"
        if not glb_path.exists():
            pending.append(png)
    return pending


def generate_single(model, image_path, output_path):
    """Generate a single GLB from a PNG image using TripoSR."""
    import torch
    import numpy as np
    from PIL import Image
    from tsr.utils import remove_background, resize_foreground

    print(f"  Loading image: {image_path.name}")
    image = Image.open(image_path)

    # Preprocess: remove background, resize, composite on gray
    print(f"  Removing background...")
    image = remove_background(image)
    image = resize_foreground(image, 0.85)
    image = np.array(image).astype(np.float32) / 255.0
    image = image[:, :, :3] * image[:, :, 3:4] + (1 - image[:, :, 3:4]) * 0.5
    image = Image.fromarray((image * 255.0).astype(np.uint8))

    print(f"  Generating 3D mesh...")
    start = time.time()

    with torch.no_grad():
        scene_codes = model([image], device='cuda')

    meshes = model.extract_mesh(scene_codes, True, resolution=256)
    meshes[0].export(str(output_path))

    elapsed = time.time() - start
    file_size = output_path.stat().st_size / 1024
    print(f"  Done! {elapsed:.1f}s ({file_size:.0f} KB)")
    return True


def main():
    parser = argparse.ArgumentParser(description="Generate 3D fish models with TRELLIS")
    parser.add_argument("--batch", type=int, default=10, help="Number of models to generate this run")
    parser.add_argument("--start", type=int, default=0, help="Starting index in the pending list")
    parser.add_argument("--species", type=str, default=None, help="Generate a specific species (slug name)")
    parser.add_argument("--all", action="store_true", help="Generate ALL pending species (could take hours)")
    parser.add_argument("--list-pending", action="store_true", help="Just list pending species and exit")
    args = parser.parse_args()

    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_pngs = get_all_species()
    print(f"Total species images: {len(all_pngs)}")

    if args.species:
        # Single species mode
        target = SPECIES_IMAGES_DIR / f"{args.species}.png"
        if not target.exists():
            print(f"ERROR: {target} not found")
            sys.exit(1)
        pending = [target]
    else:
        pending = get_pending_species(all_pngs)
        print(f"Already generated: {len(all_pngs) - len(pending)}")
        print(f"Pending: {len(pending)}")

    if args.list_pending:
        for p in pending:
            print(f"  {p.stem}")
        return

    if not pending:
        print("All species already have GLB models!")
        return

    # Determine batch
    if args.all:
        batch = pending
    else:
        batch = pending[args.start : args.start + args.batch]

    print(f"\nWill generate {len(batch)} models:")
    for p in batch:
        print(f"  - {p.stem}")

    # Load TripoSR model
    print("\nLoading TripoSR model (first run downloads ~1.5GB)...")
    import torch
    from tsr.system import TSR

    model = TSR.from_pretrained("stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt")
    model.renderer.set_chunk_size(8192)
    model.to("cuda")

    print(f"Model loaded! GPU memory used: {torch.cuda.memory_allocated() / 1e9:.1f} GB")
    print(f"{'='*60}")

    # Process batch
    success = 0
    failed = []

    for i, png_path in enumerate(batch):
        print(f"\n[{i+1}/{len(batch)}] {png_path.stem}")
        output_path = OUTPUT_DIR / f"{png_path.stem}.glb"

        try:
            generate_single(model, png_path, output_path)
            success += 1
        except Exception as e:
            print(f"  FAILED: {e}")
            failed.append((png_path.stem, str(e)))
            # Clean up partial file
            if output_path.exists():
                output_path.unlink()

        # Clear CUDA cache between models
        torch.cuda.empty_cache()

    # Summary
    print(f"\n{'='*60}")
    print(f"DONE: {success}/{len(batch)} models generated")
    print(f"Output directory: {OUTPUT_DIR}")
    if failed:
        print(f"\nFailed ({len(failed)}):")
        for name, err in failed:
            print(f"  {name}: {err}")

    remaining = len(pending) - args.start - len(batch)
    if remaining > 0 and not args.all:
        print(f"\n{remaining} more pending. Run with --start {args.start + len(batch)} for next batch.")


if __name__ == "__main__":
    main()
