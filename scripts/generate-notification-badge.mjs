/**
 * generate-notification-badge.mjs
 *
 * Renders `frontend/public/icons/badge-96.png`, the monochrome glyph Android
 * shows in the status bar for a web push notification.
 *
 * WHY A SEPARATE ASSET. Android treats the notification `badge` as a MASK: it
 * discards colour and keeps only the alpha channel, then tints the result. Every
 * existing icon in this project is wrong for that job:
 *
 *   - icon-192.png / icon-512.png have a fully opaque dark background, so the
 *     mask is a solid square. It would render as a filled white block.
 *   - aquacellum-mark.svg is SVG, and Android Chrome does not accept SVG for
 *     notification icons or badges at all.
 *
 * So the badge has to be solid white shapes on transparency, drawn heavier than
 * the full mark because it is displayed at roughly 24dp. This is a simplified
 * reading of the brand mark — membrane ring, two meridians, nucleus — with the
 * fine detail (orbital dots, gradients, inner glow) dropped, since none of it
 * survives being reduced to a silhouette that small.
 *
 * Committed as a generated asset AND kept as a script so the badge can be
 * regenerated if the mark changes, rather than being an unexplained binary.
 *
 * Run from the repo root: node scripts/generate-notification-badge.mjs
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// `sharp` is a frontend dependency and Node resolves packages relative to THIS
// file, so a bare `import sharp from "sharp"` fails from the repo root. Resolve
// it against frontend/package.json instead. (This script cannot simply live
// under frontend/scripts/ — that path is gitignored, which would leave the
// generated PNG committed with no visible provenance.)
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const sharp = require("sharp");

const OUT = fileURLToPath(new URL("../frontend/public/icons/badge-96.png", import.meta.url));

// Solid white on transparent. Stroke widths are deliberately heavy: at status-bar
// size a 4px stroke from the 400px original would disappear entirely.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <g fill="none" stroke="#ffffff" stroke-linecap="round">
    <!-- Membrane ring -->
    <circle cx="48" cy="48" r="36" stroke-width="7"/>
    <!-- Meridians: the two opposing currents of the mark, mirrored -->
    <path d="M48 12 C60 27, 66 42, 60 48 C54 54, 60 69, 48 84" stroke-width="6"/>
    <path d="M48 12 C36 27, 30 42, 36 48 C42 54, 36 69, 48 84" stroke-width="6"/>
  </g>
  <!-- Nucleus -->
  <circle cx="48" cy="48" r="11" fill="#ffffff"/>
</svg>`;

mkdirSync(dirname(OUT), { recursive: true });

await sharp(Buffer.from(svg))
  .resize(96, 96, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile(OUT);

const meta = await sharp(OUT).metadata();
console.log(
  `badge-96.png written: ${meta.width}x${meta.height}, alpha=${meta.hasAlpha}, channels=${meta.channels}`
);
