/**
 * The installed app carries the product name and the Daylight colours: the
 * manifest still said "Aquadex — Hobbyist & Breeder Protocol" on a near-black
 * #0a0e1a, so an installed app opened on a dark splash under the old name.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const VITE = read("../../vite.config.js");
const SW = read("../sw.js");

describe("PWA identity", () => {
  it("names the app Aquacellum", () => {
    expect(VITE).toMatch(/name: 'Aquacellum',/);
    expect(VITE).toMatch(/short_name: 'Aquacellum',/);
    expect(VITE).not.toMatch(/name: 'Aquadex/);
  });
  it("uses the light theme colours", () => {
    expect(VITE).toMatch(/background_color: '#f5f9fa'/);
    expect(VITE).toMatch(/theme_color: '#ffffff'/);
  });
  it("titles push notifications Aquacellum", () => {
    expect(SW).toMatch(/showNotification\(payload\.title \|\| "Aquacellum"/);
    expect(SW).not.toMatch(/"Aquadex"/);
  });
});
