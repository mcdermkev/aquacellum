/**
 * remove-echo-bg.mjs
 *
 * One-off tool: strips the baked-in dark rectangular background out of the
 * Echo stage PNGs so they become true alpha-transparent sprites (fish only).
 *
 * Approach: flood-fill "magic wand" region growing starting from every
 * border pixel, using neighbor-to-neighbor color distance (not a single
 * global background color) so it correctly follows the background's
 * radial light-shaft gradient without eating into the fish body.
 * Edge alpha is feathered with a small blur for anti-aliased cutout edges.
 *
 * Usage:
 *   node scripts/remove-echo-bg.mjs            (writes preview to scripts/echo-bg-removed/)
 *   node scripts/remove-echo-bg.mjs --apply    (overwrites frontend/public/echo-stages/*.png)
 */

import sharp from "../frontend/node_modules/sharp/dist/index.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, "..", "frontend", "public", "echo-stages");
const PREVIEW_DIR = path.join(__dirname, "echo-bg-removed");

const FILES = [
  "stage-0-egg.png",
  "stage-1-larva.png",
  "stage-2-fry.png",
  "stage-3-juvenile.png",
  "stage-4-adult.png",
  "stage-5-elder.png",
  "stage-6-legendary.png",
];

// Neighbor color-distance tolerance for region growing.
// Background is a smooth gradient so adjacent background pixels are close;
// the fish edge has a sharp jump in color/brightness.
const TOLERANCE = 26;

// Maximum color distance a pixel is allowed to have from the ORIGINAL seed
// (border) color region it grew from. Pure neighbor-to-neighbor comparison
// lets the flood fill "drift" arbitrarily far in color space over many small
// steps (each step under TOLERANCE, but the cumulative walk crosses into the
// fish body on low-contrast boundaries). Anchoring each pixel's total drift
// to a running anchor color prevents that tunnel-through.
const MAX_DRIFT_FROM_ANCHOR = 60;
// Re-anchor every N BFS steps so gradual, legitimate gradient traversal
// (e.g. the radial light shaft) still works across large background areas.
const REANCHOR_INTERVAL = 6;

// Absolute luminance ceiling: the source art is a lit fish silhouette over a
// dark navy/black vignette. Background pixels are consistently dark
// (luminance well under 50 in every sampled stage); the fish body is
// consistently much brighter, even at its darkest shaded/fin edges.
// Neighbor-distance + anchor-distance alone can still tunnel through a soft,
// anti-aliased transition zone one small step at a time (confirmed on
// stage-3-juvenile and stage-5-elder, which lost 90%+ of the fish body under
// the neighbor/anchor-only rules). This ceiling is an orthogonal, absolute
// check: no matter how small each color step is, a pixel this bright can
// never be reclassified as background.
const MAX_BG_LUMINANCE = 62;

// Geometric safeguard: color/luminance heuristics alone cannot separate
// "dark background" from "dark shaded region of the fish" once the flood
// fill is deep in the interior of the frame — confirmed on stage-5-elder,
// where the fish itself has shadow regions as dark as the vignette
// background (original pixel luminance ~38, same range as true background).
// Once the fill has traveled more than BORDER_ZONE_FRACTION of the shorter
// dimension away from the nearest edge, require a much tighter, near-exact
// color match to the running anchor before continuing — this lets the loose
// tolerance clean up the border/corner vignette (the actual card-glow bug)
// while preventing the fill from tunneling deep into the fish silhouette.
const BORDER_ZONE_FRACTION = 0.16;
const DEEP_ZONE_TOLERANCE = 10;

// Island cleanup: the border-seeded flood fill can leave isolated pockets
// of background "trapped" if a thin band of fish-colored pixels seals them
// off from the border path before the fill reaches them (confirmed on
// stage-5-elder: a ~45k-pixel chunk near the top of the frame, fully
// disconnected from the main fish silhouette, rendered as an opaque glowing
// box above the head). After the border flood, we label connected
// components of the remaining "not background" pixels. The single largest
// component is kept as the real fish body; any other component is a
// candidate trapped island.
//
// An absolute luminance cutoff is NOT reliable here: the background is a
// bright radial "light shaft" gradient in places (confirmed sampled colors
// around R=17,G=100,B=127, luminance ~75-90 — brighter than typical dark
// vignette background but still clearly the same gradient family, not fish
// anatomy). Instead, compare each island's average color against a sampled
// palette of pixels the primary flood fill already confirmed as background
// — a much more direct signal than guessing a brightness threshold.
const ISLAND_BG_PALETTE_MAX_DIST = 45;
const ISLAND_BG_PALETTE_SAMPLE_STRIDE = 37; // prime stride for a spread sample

function colorDist(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

async function processImage(filePath) {
  const img = sharp(filePath);
  const { data, info } = await img.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info; // channels should be 4 (RGBA)

  const total = width * height;
  const isBg = new Uint8Array(total); // 1 = background, 0 = unknown/fish
  const visited = new Uint8Array(total);

  const idx = (x, y) => y * width + x;
  const pixOff = (x, y) => idx(x, y) * channels;

  const borderZonePx = Math.round(Math.min(width, height) * BORDER_ZONE_FRACTION);
  const distFromEdge = (x, y) => Math.min(x, y, width - 1 - x, height - 1 - y);

  // BFS queue seeded from every border pixel
  const queue = [];
  for (let x = 0; x < width; x++) {
    queue.push([x, 0]);
    queue.push([x, height - 1]);
  }
  for (let y = 0; y < height; y++) {
    queue.push([0, y]);
    queue.push([width - 1, y]);
  }

  // Per-pixel anchor color (the color region-growing "started from" for that
  // pixel's chain) and step count since last re-anchor. Prevents color drift
  // from tunneling through low-contrast fish-body edges over many hops.
  const anchorR = new Uint8Array(total);
  const anchorG = new Uint8Array(total);
  const anchorB = new Uint8Array(total);
  const stepsSinceAnchor = new Uint8Array(total);

  for (const [x, y] of queue) {
    const i = idx(x, y);
    if (!visited[i]) {
      visited[i] = 1;
      isBg[i] = 1;
      const off = pixOff(x, y);
      anchorR[i] = data[off];
      anchorG[i] = data[off + 1];
      anchorB[i] = data[off + 2];
      stepsSinceAnchor[i] = 0;
    }
  }
  // re-run as proper BFS with a real queue array (reuse `queue` as the frontier)
  let frontier = queue.filter(([x, y]) => isBg[idx(x, y)] === 1);

  while (frontier.length > 0) {
    const next = [];
    for (const [x, y] of frontier) {
      const i = idx(x, y);
      const off = pixOff(x, y);
      const r = data[off], g = data[off + 1], b = data[off + 2];
      const aR = anchorR[i], aG = anchorG[i], aB = anchorB[i];
      const steps = stepsSinceAnchor[i];

      const neighbors = [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = idx(nx, ny);
        if (visited[ni]) continue;
        const noff = pixOff(nx, ny);
        const nr = data[noff], ng = data[noff + 1], nb = data[noff + 2];

        const effectiveTolerance = distFromEdge(nx, ny) > borderZonePx ? DEEP_ZONE_TOLERANCE : TOLERANCE;
        const neighborStepOk = colorDist(r, g, b, nr, ng, nb) <= effectiveTolerance;
        const anchorDistOk = colorDist(aR, aG, aB, nr, ng, nb) <= MAX_DRIFT_FROM_ANCHOR;
        const luminanceOk = luminance(nr, ng, nb) <= MAX_BG_LUMINANCE;

        if (neighborStepOk && anchorDistOk && luminanceOk) {
          visited[ni] = 1;
          isBg[ni] = 1;

          // Re-anchor periodically so long, legitimate gradient traversals
          // (radial light shaft across a large background area) can still
          // proceed, while short-range drift-through into the fish is capped.
          if (steps + 1 >= REANCHOR_INTERVAL) {
            anchorR[ni] = nr;
            anchorG[ni] = ng;
            anchorB[ni] = nb;
            stepsSinceAnchor[ni] = 0;
          } else {
            anchorR[ni] = aR;
            anchorG[ni] = aG;
            anchorB[ni] = aB;
            stepsSinceAnchor[ni] = steps + 1;
          }

          next.push([nx, ny]);
        }
        // Do NOT mark visited on failure: a local gradient step can be
        // steep from one neighbor's direction but shallow from another.
        // Leaving it unvisited lets a different (successful) neighbor
        // reconsider this pixel later in the BFS instead of permanently
        // walling it off.
      }
    }
    frontier = next;
  }

  // ─── Island cleanup pass ────────────────────────────────────────────────
  // Label connected components of the "not background" (fish) pixels.
  // Keep only the largest as the real fish; reclassify smaller isolated
  // islands as background if their color closely matches a pixel already
  // confirmed as background by the primary flood fill.
  {
    // Sample a spread of confirmed-background pixels to build a comparison
    // palette (avoids needing every single background pixel — a
    // representative sample is enough for nearest-color matching).
    const bgPalette = [];
    for (let p = 0; p < total; p += ISLAND_BG_PALETTE_SAMPLE_STRIDE) {
      if (isBg[p]) {
        const off = p * channels;
        bgPalette.push([data[off], data[off + 1], data[off + 2]]);
      }
    }

    const nearestBgDist = (r, g, b) => {
      let best = Infinity;
      for (const [pr, pg, pb] of bgPalette) {
        const d = colorDist(r, g, b, pr, pg, pb);
        if (d < best) best = d;
        if (best <= ISLAND_BG_PALETTE_MAX_DIST) break; // early exit, good enough match
      }
      return best;
    };

    const compLabel = new Int32Array(total).fill(-1);
    let nextLabel = 0;
    const componentSizes = [];
    const stack = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = idx(x, y);
        if (isBg[i] || compLabel[i] !== -1) continue;

        stack.length = 0;
        stack.push(x, y);
        compLabel[i] = nextLabel;
        let count = 0;

        while (stack.length) {
          const cy = stack.pop();
          const cx = stack.pop();
          count++;
          const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
          for (const [nx, ny] of neighbors) {
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = idx(nx, ny);
            if (!isBg[ni] && compLabel[ni] === -1) {
              compLabel[ni] = nextLabel;
              stack.push(nx, ny);
            }
          }
        }
        componentSizes.push(count);
        nextLabel++;
      }
    }

    // Find the largest component — that's the real fish body.
    let largestLabel = -1;
    let largestSize = -1;
    for (let l = 0; l < componentSizes.length; l++) {
      if (componentSizes[l] > largestSize) {
        largestSize = componentSizes[l];
        largestLabel = l;
      }
    }

    // Any other component is a candidate trapped island. Reclassify as
    // background only if dark enough to plausibly be background — avoids
    // erasing a genuinely disconnected bright fish part (e.g. a fin tip
    // separated by a thin gap).
    for (let p = 0; p < total; p++) {
      const l = compLabel[p];
      if (l === -1 || l === largestLabel) continue;
      const off = p * channels;
      const dist = nearestBgDist(data[off], data[off + 1], data[off + 2]);
      if (dist <= ISLAND_BG_PALETTE_MAX_DIST) {
        isBg[p] = 1;
      }
    }
  }

  // ─── Decorative top-element crop ─────────────────────────────────────────
  // The source art on stages 3, 4, and 6 has a painted decorative element
  // (looks like a kelp/coral canopy or light shaft) near the top of the
  // frame that was invisible against the old opaque background but became
  // visible once transparency was applied. It's continuously connected to
  // the fish body (no gap row), so the island-cleanup pass can't catch it.
  // We crop it geometrically: erase all opaque pixels above a per-stage
  // cutoff line (determined from width-profile analysis of the art).
  const topCropLines = {
    "stage-3-juvenile.png": Math.round(height * 0.15),  // ~192px on 1280h
    "stage-4-adult.png": Math.round(height * 0.075),    // ~96px on 1280h
    "stage-6-legendary.png": Math.round(height * 0.14), // ~179px on 1280h
  };
  const basename = filePath.split(/[\\/]/).pop();
  const cropLine = topCropLines[basename];
  if (cropLine) {
    for (let y = 0; y < cropLine; y++) {
      for (let x = 0; x < width; x++) {
        isBg[idx(x, y)] = 1;
      }
    }
  }

  // Build alpha channel: bg -> 0, fish -> 255
  const outData = Buffer.from(data); // copy RGBA
  for (let p = 0; p < total; p++) {
    const off = p * channels;
    outData[off + 3] = isBg[p] ? 0 : 255;
  }

  // Feather edges: blur just the alpha channel slightly for anti-aliasing
  const alphaOnly = Buffer.alloc(total);
  for (let p = 0; p < total; p++) alphaOnly[p] = outData[p * channels + 3];

  // NOTE: sharp expands a single-channel (grayscale) raw buffer to 3
  // channels (R=G=B) when it passes through .blur(), even though we
  // never asked for a colorspace change. Read back the actual channel
  // count instead of assuming 1:1 indexing, or every pixel after the
  // first row ends up reading misaligned/garbage bytes.
  const { data: blurredAlpha, info: blurredInfo } = await sharp(alphaOnly, {
    raw: { width, height, channels: 1 },
  })
    .blur(1.2)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const blurredChannels = blurredInfo.channels;

  for (let p = 0; p < total; p++) {
    outData[p * channels + 3] = blurredAlpha[p * blurredChannels];
  }

  const outBuffer = await sharp(outData, { raw: { width, height, channels } })
    .png()
    .toBuffer();

  return outBuffer;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const outDir = apply ? SRC_DIR : PREVIEW_DIR;

  if (!apply && !fs.existsSync(PREVIEW_DIR)) {
    fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  }

  for (const file of FILES) {
    const srcPath = path.join(SRC_DIR, file);
    console.log(`Processing ${file}...`);
    const result = await processImage(srcPath);
    const outPath = path.join(outDir, file);
    fs.writeFileSync(outPath, result);
    console.log(`  -> wrote ${outPath} (${(result.length / 1024).toFixed(1)} KB)`);
  }

  console.log(apply ? "Applied in place." : `Preview written to ${PREVIEW_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
