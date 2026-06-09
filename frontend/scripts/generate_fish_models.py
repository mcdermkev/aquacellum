"""
Fish 3D Model Generator — Multi-Backend
=========================================
Generates GLB 3D models from species PNG images using multiple backends:
  1. Tripo3D API (free 300 credits/mo, fast, reliable)
  2. HuggingFace TRELLIS Space (free via gradio_client, quota-limited)

Usage:
  pip install gradio_client httpx
  python generate_fish_models.py --backend tripo --api-key YOUR_KEY --batch 10
  python generate_fish_models.py --backend huggingface --batch 5

The reef auto-detects GLBs in public/models/fish/{slug}.glb — no code changes needed.
"""

import sys
import os
import argparse
import time
import base64
import json
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
SPECIES_IMAGES_DIR = PROJECT_ROOT / "public" / "species-images"
OUTPUT_DIR = PROJECT_ROOT / "public" / "models" / "fish"

# Priority species list (most popular aquarium fish)
PRIORITY_SPECIES = [
    "betta-splendens",
    "paracheirodon-innesi",
    "poecilia-reticulata",
    "corydoras-panda",
    "ancistrus-cirrhosus",
    "mikrogeophagus-ramirezi",
    "danio-margaritatus",
    "pterophyllum-scalare",
    "carassius-auratus",
    "neocaridina-davidi",
    "symphysodon-discus",
    "apistogramma-cacatuoides",
    "hyphessobrycon-herbertaxelrodi",
    "otocinclus-vittatus",
    "pangio-kuhlii",
    "crossocheilus-oblongus",
    "trigonostigma-heteromorpha",
    "corydoras-aeneus",
    "xiphophorus-hellerii",
    "poecilia-sphenops",
]


def get_pending(priority_first=True):
    """Get species that don't have GLBs yet."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    all_pngs = sorted(SPECIES_IMAGES_DIR.glob("*.png"))

    if priority_first:
        # Put priority species first, then the rest
        priority = [SPECIES_IMAGES_DIR / f"{s}.png" for s in PRIORITY_SPECIES
                    if (SPECIES_IMAGES_DIR / f"{s}.png").exists()]
        rest = [p for p in all_pngs if p not in priority]
        ordered = priority + rest
    else:
        ordered = all_pngs

    pending = [p for p in ordered if not (OUTPUT_DIR / f"{p.stem}.glb").exists()]
    return pending


# ============================================================
# Backend: Tripo3D API
# ============================================================

def generate_tripo(image_path, output_path, api_key):
    """Generate GLB via Tripo3D API. Costs 1 credit per model."""
    import httpx

    base_url = "https://api.tripo3d.ai/v2/openapi"
    headers = {"Authorization": f"Bearer {api_key}"}

    # Step 1: Upload image
    print(f"    Uploading to Tripo...")
    with open(image_path, "rb") as f:
        files = {"file": (image_path.name, f, "image/png")}
        resp = httpx.post(f"{base_url}/upload", headers=headers, files=files, timeout=60)
    resp.raise_for_status()
    upload_data = resp.json()
    if upload_data.get("code") != 0:
        raise RuntimeError(f"Upload failed: {upload_data}")
    file_token = upload_data["data"]["image_token"]

    # Step 2: Create task
    print(f"    Creating 3D generation task...")
    task_payload = {
        "type": "image_to_model",
        "file": {"type": "png", "file_token": file_token},
        "model_version": "v2.5-20250123",
    }
    resp = httpx.post(f"{base_url}/task", headers=headers, json=task_payload, timeout=30)
    resp.raise_for_status()
    task_data = resp.json()
    if task_data.get("code") != 0:
        raise RuntimeError(f"Task creation failed: {task_data}")
    task_id = task_data["data"]["task_id"]

    # Step 3: Poll until complete
    print(f"    Generating (task {task_id[:8]}...)...")
    for attempt in range(120):  # Max 10 minutes
        time.sleep(5)
        resp = httpx.get(f"{base_url}/task/{task_id}", headers=headers, timeout=30)
        resp.raise_for_status()
        status_data = resp.json()["data"]
        status = status_data.get("status", "unknown")

        if status == "success":
            break
        elif status in ("failed", "cancelled"):
            raise RuntimeError(f"Task failed: {status_data.get('error', 'unknown')}")
        elif status == "running":
            progress = status_data.get("progress", 0)
            if attempt % 6 == 0:
                print(f"    Progress: {progress}%")
    else:
        raise RuntimeError("Timeout waiting for generation")

    # Step 4: Download GLB
    model_url = status_data.get("output", {}).get("model")
    if not model_url:
        # Try to get GLB from the rendered result
        model_url = status_data.get("output", {}).get("pbr_model") or \
                    status_data.get("output", {}).get("base_model")
    if not model_url:
        raise RuntimeError(f"No model URL in result: {status_data}")

    print(f"    Downloading GLB...")
    resp = httpx.get(model_url, timeout=120, follow_redirects=True)
    resp.raise_for_status()
    output_path.write_bytes(resp.content)
    size_kb = len(resp.content) / 1024
    print(f"    Saved ({size_kb:.0f} KB)")
    return True


# ============================================================
# Backend: HuggingFace TRELLIS Space (gradio_client)
# ============================================================

def generate_huggingface(image_path, output_path):
    """Generate GLB via TRELLIS HuggingFace Space (free, quota-limited)."""
    from gradio_client import Client, handle_file

    print(f"    Connecting to HF Space...")
    client = Client("trellis-community/TRELLIS")

    # Step 1: Preprocess image
    print(f"    Preprocessing...")
    processed = client.predict(
        image=handle_file(str(image_path)),
        api_name="/preprocess_image"
    )

    # Step 2: Generate 3D (returns video + download links)
    print(f"    Generating 3D model (this takes 30-90 seconds)...")
    result = client.predict(
        randomize_seed=True,
        seed=42,
        ss_guidance_strength=7.5,
        ss_sampling_steps=12,
        slat_guidance_strength=3.0,
        slat_sampling_steps=12,
        multiimage_algo="stochastic",
        api_name="/image_to_3d"
    )

    # Step 3: Extract GLB
    print(f"    Extracting GLB mesh...")
    glb_result = client.predict(
        mesh_simplify=0.95,
        texture_size=1024,
        api_name="/extract_glb"
    )

    # glb_result should be a file path
    if isinstance(glb_result, (list, tuple)):
        glb_file = glb_result[0] if glb_result else None
    else:
        glb_file = glb_result

    if glb_file and Path(glb_file).exists():
        import shutil
        shutil.copy2(glb_file, output_path)
        size_kb = output_path.stat().st_size / 1024
        print(f"    Saved ({size_kb:.0f} KB)")
        return True
    else:
        raise RuntimeError(f"GLB extraction failed, got: {glb_result}")


# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Generate 3D fish models")
    parser.add_argument("--backend", choices=["tripo", "huggingface"], default="tripo",
                        help="Which service to use")
    parser.add_argument("--api-key", type=str, default=None,
                        help="API key (for Tripo, or set TRIPO_API_KEY env var)")
    parser.add_argument("--batch", type=int, default=10, help="Number to generate")
    parser.add_argument("--start", type=int, default=0, help="Starting offset")
    parser.add_argument("--species", type=str, default=None, help="Generate specific species")
    parser.add_argument("--list-pending", action="store_true", help="Just list what's pending")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    all_pngs = sorted(SPECIES_IMAGES_DIR.glob("*.png"))
    pending = get_pending()

    print(f"Total species images: {len(all_pngs)}")
    print(f"Already generated:    {len(all_pngs) - len(pending)}")
    print(f"Pending:              {len(pending)}")
    print(f"Backend:              {args.backend}")

    if args.list_pending:
        for p in pending[:50]:
            print(f"  {p.stem}")
        if len(pending) > 50:
            print(f"  ... and {len(pending) - 50} more")
        return

    if args.species:
        target = SPECIES_IMAGES_DIR / f"{args.species}.png"
        if not target.exists():
            print(f"ERROR: {target} not found")
            sys.exit(1)
        batch = [target]
    else:
        batch = pending[args.start:args.start + args.batch]

    if not batch:
        print("Nothing to generate!")
        return

    # Resolve API key for Tripo
    api_key = args.api_key or os.environ.get("TRIPO_API_KEY")
    if args.backend == "tripo" and not api_key:
        print("\nTo use Tripo3D, you need a free API key:")
        print("  1. Sign up at https://www.tripo3d.ai (free, 300 credits/month)")
        print("  2. Go to Settings → API → Copy your key")
        print("  3. Run: python generate_fish_models.py --backend tripo --api-key YOUR_KEY")
        print("\nOr set env var: TRIPO_API_KEY=your_key")
        print("\nAlternatively, use --backend huggingface (no key needed, slower)")
        sys.exit(1)

    print(f"\nGenerating {len(batch)} models:")
    for p in batch:
        print(f"  - {p.stem}")
    print()

    success = 0
    failed = []

    for i, png_path in enumerate(batch):
        print(f"[{i+1}/{len(batch)}] {png_path.stem}")
        out_path = OUTPUT_DIR / f"{png_path.stem}.glb"

        try:
            if args.backend == "tripo":
                generate_tripo(png_path, out_path, api_key)
            else:
                generate_huggingface(png_path, out_path)
            success += 1
        except Exception as e:
            print(f"    FAILED: {e}")
            failed.append((png_path.stem, str(e)))
            if out_path.exists():
                out_path.unlink()

        # Rate limit politeness
        if i < len(batch) - 1:
            time.sleep(2)

    print(f"\n{'='*60}")
    print(f"DONE: {success}/{len(batch)} models generated")
    print(f"Output: {OUTPUT_DIR}")
    if failed:
        print(f"\nFailed ({len(failed)}):")
        for name, err in failed:
            print(f"  {name}: {err}")


if __name__ == "__main__":
    main()
