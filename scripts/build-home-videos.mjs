#!/usr/bin/env node
/**
 * build-home-videos.mjs — write frontend/public/home-videos.json, the list of
 * species slugs that have a hover video in frontend/public/videos/species/.
 *
 * The homepage shows these species first and plays the clip on hover. The
 * browser cannot list a directory, so it reads this small file instead. Re-run
 * after adding or removing a species video:
 *
 *   node scripts/build-home-videos.mjs
 *
 * homeVideos.test.js fails if the committed file is stale.
 */

import { readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const VIDEO_DIR = `${ROOT}frontend/public/videos/species`;
export const OUT_PATH = `${ROOT}frontend/public/home-videos.json`;

/** Slugs (file names without .mp4), sorted, same slug rule as species-index.json `u`. */
export function listVideoSlugs(dir = VIDEO_DIR) {
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".mp4"))
    .map((name) => name.slice(0, -4))
    .sort();
}

export function serializeVideos(slugs) {
  return `${JSON.stringify(slugs)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const slugs = listVideoSlugs();
  writeFileSync(OUT_PATH, serializeVideos(slugs));
  console.log(`home-videos.json: ${slugs.length} species videos`);
}
