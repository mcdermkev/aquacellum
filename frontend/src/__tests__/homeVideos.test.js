/**
 * The homepage's list of species with hover videos must match the files in
 * public/videos/species/. Regenerate with: node scripts/build-home-videos.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { OUT_PATH, listVideoSlugs, serializeVideos } from "../../../scripts/build-home-videos.mjs";
import { INDEX_PATH } from "../../../scripts/build-species-index.mjs";

const committed = readFileSync(OUT_PATH, "utf8");
const slugs = JSON.parse(committed);
const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
const HOME = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");

describe("home-videos.json", () => {
  it("is up to date with public/videos/species (run scripts/build-home-videos.mjs)", () => {
    expect(committed.replace(/\r\n/g, "\n")).toBe(serializeVideos(listVideoSlugs()));
  });

  it("only lists species that exist in the species index", () => {
    const known = new Set(index.map((r) => r.u));
    for (const s of slugs) expect(known.has(s), `${s} is not in species-index.json`).toBe(true);
    expect(slugs.length).toBeGreaterThan(0);
  });

  it("is read by the homepage, which loads clips on demand", () => {
    expect(HOME).toContain('fetch("/home-videos.json")');
    // Clips are created on hover, never preloaded with the page.
    expect(HOME).toContain('preload = "none"');
    expect(HOME).toContain("prefers-reduced-motion");
  });
});
