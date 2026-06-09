# Gaussian Splat Files

Place `.splat` files here for photorealistic captured environments.

## How to Capture

### Option 1: Phone capture (easiest)
1. Download Luma AI app (iOS/Android)
2. Record a slow orbit around your aquarium / reef tank
3. Process in-app → Export as `.splat`
4. Place here

### Option 2: Nerfstudio (full control)
1. Record video of an aquarium (60+ frames, overlapping angles)
2. Install nerfstudio: `pip install nerfstudio`
3. Train: `ns-train splatfacto --data ./your-video`
4. Export: `ns-export gaussian-splat --load-config outputs/.../config.yml`
5. Place exported `.splat` file here

### Option 3: Polycam (web/phone)
1. Capture with Polycam app or web uploader
2. Export as Gaussian Splat format
3. Place here

## Usage in the Reef

The `SplatEnvironment` component loads from this directory by name:
```jsx
<SplatEnvironment name="reef-capture" />  // loads /splats/reef-capture.splat
```

Files that don't exist will silently skip (no error shown to user).

## Recommended Captures
- `reef-capture.splat` — Main aquarium background
- `planted-tank.splat` — Lush planted aquarium
- `rocky-cichlid.splat` — African rift lake setup
- `blackwater.splat` — Amazonian tannin-stained tank
