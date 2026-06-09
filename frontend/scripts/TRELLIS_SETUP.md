# 3D Fish Model Generation — Local Setup (TripoSR)

## What Works ✅

**TripoSR** by Stability AI + Tripo AI runs perfectly on your RTX 5080:
- ~2 seconds per fish model
- 1.7 GB VRAM usage
- No CUDA toolkit or special kernels needed
- MIT license, free, unlimited local use

## Quick Start

```powershell
# Activate the conda env (already set up)
$env:Path = "$env:USERPROFILE\miniconda3\condabin;$env:Path"
conda activate trellis

# Generate 10 fish models
cd C:\Users\mcder\Desktop\fish-dex-protocol
python frontend\scripts\trellis_generate.py --batch 10

# Generate a specific species
python frontend\scripts\trellis_generate.py --species pterophyllum-scalare

# Generate ALL pending species (~310 fish, takes ~15 minutes)
python frontend\scripts\trellis_generate.py --all

# List what hasn't been generated yet
python frontend\scripts\trellis_generate.py --list-pending
```

## Environment Details

| Component | Version |
|-----------|---------|
| Python | 3.10.20 (conda env: trellis) |
| PyTorch | 2.11.0+cu128 |
| GPU | NVIDIA RTX 5080 (17.1 GB, sm_120) |
| Model | stabilityai/TripoSR (~1.5 GB download) |
| Backend | TripoSR (feedforward, no sparse attention) |

## Output

GLB files are saved to `frontend/public/models/fish/{slug}.glb`

The reef automatically detects them:
1. `FishSchool.jsx` sends a HEAD request to `/models/fish/{slug}.glb`
2. If found → loads via `ProceduralSwim.jsx`  
3. Applies procedural swim animation (spine undulation, tail oscillation)
4. No code changes, no rebuilds — just drop files and refresh

## Output Specs

- Triangle count: ~50,000-100,000 (vertex colors)
- Format: GLB (embedded vertex colors)
- File size: 250 KB – 2.5 MB per fish
- Resolution: 256³ marching cubes grid

## Batch Strategy

At ~2s per fish + ~3s rembg preprocessing = ~5s per model:
- 50 fish ≈ 4 minutes
- 100 fish ≈ 8 minutes
- All 311 fish ≈ 26 minutes

Run `--batch 50` at a time to avoid memory buildup.

## Why Not TRELLIS?

TRELLIS produces higher quality models but requires:
- Flash Attention or xformers (neither supports RTX 5080 sm_120 yet)
- Sparse attention kernels that can't use PyTorch's native SDPA efficiently
- The SLAT diffusion step takes 10+ minutes per fish with our workaround

Once PyTorch/xformers ship sm_120 pre-built kernels (expected in late 2025),
TRELLIS will work. Until then, TripoSR is the fast path.

## Troubleshooting

**"torchmcubes was not compiled with CUDA support"**
→ The scikit-image shim handles this. Mesh extraction runs on CPU but only takes ~0.5s.

**Model download fails**
→ Set `HF_TOKEN` env var or run `huggingface-cli login`

**Out of memory**
→ Reduce `--chunk-size` or `--resolution` in the script
