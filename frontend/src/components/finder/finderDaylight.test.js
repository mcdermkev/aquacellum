/**
 * Fish Finder on Daylight — source guards (node env, no DOM; same convention
 * as finderCopy.test.js and breeder/BreederTerminal.catalog.test.js).
 *
 * Two kinds of guard:
 *   1. Styling: the finder keeps its own ff-* stylesheet with 44px targets,
 *      visible focus and reduced motion, and never reaches into the embedded
 *      BreedGallery (or other shared components) with descendant selectors.
 *   2. Behaviour: the redesign was markup only. These fail if a rework drops
 *      the tab hand-offs, deep links, toggle semantics or the fit engine calls.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { WATER_FILTERS } from "./waterFilter.js";
import { DISCOVERY_INTENTS } from "./discoveryIntents.js";
import { WATER_ICON, INTENT_ICON } from "./finderIcons.js";

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const readRaw = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const read = (rel) => stripComments(readRaw(rel));

const CSS = read("./FishFinderDaylight.css");
const SURFACES = {
  "FishFinder.jsx": read("./FishFinder.jsx"),
  "MyDexPanel.jsx": read("./MyDexPanel.jsx"),
  "CasualSpeciesDetail.jsx": read("./CasualSpeciesDetail.jsx"),
};
const FINDER = SURFACES["FishFinder.jsx"];
const DETAIL = SURFACES["CasualSpeciesDetail.jsx"];

/** Every selector in the stylesheet (at-rule preludes skipped). */
function selectors(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1].trim();
    if (!prelude || prelude.startsWith("@")) continue;
    for (const s of prelude.split(",")) out.push(s.trim());
  }
  return out;
}

describe("FishFinderDaylight.css — Daylight styling", () => {
  const minHeight = (cls) =>
    new RegExp(`\\.${cls}\\s*\\{[^}]*min-height:\\s*(4[4-9]|[5-9]\\d)px`);

  it("buttons, the tank picker and the search field are at least 44px tall", () => {
    expect(CSS).toMatch(minHeight("ff-btn"));
    expect(CSS).toMatch(minHeight("ff-select"));
    expect(CSS).toMatch(minHeight("ff-search-input"));
  });

  it("chips and inline links grow to 44px on touch and narrow screens", () => {
    expect(CSS).toMatch(
      /@media \(pointer: coarse\), \(max-width: 768px\)\s*\{[^}]*\.ff-chip,\s*\.ff-link\s*\{\s*min-height:\s*44px/
    );
  });

  it("has a visible focus ring and a reduced-motion block", () => {
    expect(CSS).toMatch(/:focus-visible[^{]*\{[^}]*outline:\s*2px solid/);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("uses the Daylight type pair, not the retired fonts or the old sky blue", () => {
    expect(CSS).toMatch(/var\(--font-display\)/);
    expect(CSS).toMatch(/var\(--font-body\)/);
    for (const retired of ["Plus Jakarta Sans", "DM Sans", "Manrope", "rgba(56, 189, 248"]) {
      expect(CSS.includes(retired), retired).toBe(false);
    }
  });

  it("only styles ff-* classes (never restyles the embedded gallery or shared components)", () => {
    // Allowed descendants: another ff-* class, or an icon svg inside one of
    // our own leaf controls. `.ff`, `.ff-detail`, `.ff-panel`, `.ff-tips` and
    // `.ff-browse` wrap components this file does not own, so an `svg`,
    // element or foreign class under them would leak.
    const ICON_HOSTS = new Set(["ff-chip", "ff-btn", "ff-dex-title", "ff-verdict", "ff-care-chip"]);
    for (const sel of selectors(CSS)) {
      const parts = sel.split(/\s*>\s*|\s+/).filter(Boolean);
      expect(parts[0], sel).toMatch(/^\.ff(-[\w-]+)?\b/);
      for (let i = 1; i < parts.length; i++) {
        if (/^\.ff-/.test(parts[i])) continue;
        const host = (parts[i - 1].match(/^\.(ff-[\w-]+)/) || [])[1];
        expect(parts[i] === "svg" && ICON_HOSTS.has(host), `leaky selector: ${sel}`).toBe(true);
      }
    }
  });

  it("gives every water filter and discovery intent an icon", () => {
    for (const w of WATER_FILTERS) expect(WATER_ICON[w.id], w.id).toBeTruthy();
    for (const intent of DISCOVERY_INTENTS) expect(INTENT_ICON[intent.id], intent.id).toBeTruthy();
  });
});

describe("Fish Finder surfaces — Daylight markup", () => {
  it("render no emoji (icons come from Phosphor)", () => {
    for (const [name, src] of Object.entries(SURFACES)) {
      expect(/\p{Extended_Pictographic}/u.test(src), name).toBe(false);
      expect(src, name).toMatch(/from "@phosphor-icons\/react"/);
    }
  });

  it("use the ff-* stylesheet, not the old sheets or shared card/button classes", () => {
    for (const [name, src] of Object.entries(SURFACES)) {
      expect(src, name).toMatch(/import "\.\/FishFinderDaylight\.css"/);
      for (const retired of [
        "FishFinder.css",
        "CasualSpeciesDetail.css",
        "glass-card",
        "species-card-premium__badge",
        "btn-primary",
        "btn-secondary",
        "cg-chip",
        "cg-tip",
        "cg-ask",
      ]) {
        expect(src.includes(retired), `${name} still uses ${retired}`).toBe(false);
      }
    }
  });

  it("takes the verdict tone from CSS classes, not VERDICT_CHIP's low-contrast colors", () => {
    expect(DETAIL.includes("verdictChip.color")).toBe(false);
    expect(DETAIL.includes("verdictChip.border")).toBe(false);
    expect(DETAIL).toMatch(/"ff-verdict ff-verdict--" \+ presentationKind/);
  });

  it("names each tank picker with its visible label", () => {
    expect(FINDER).toMatch(/htmlFor="ff-tank-picker"/);
    expect(FINDER).toMatch(/id="ff-tank-picker"/);
    expect(DETAIL).toMatch(/htmlFor="ff-detail-tank-picker"/);
    expect(DETAIL).toMatch(/id="ff-detail-tank-picker"/);
  });

  it("labels both chip groups with their visible headings", () => {
    expect(FINDER).toMatch(/role="group" aria-labelledby="ff-water-label"/);
    expect(FINDER).toMatch(/role="group" aria-labelledby="ff-intent-label"/);
  });
});

describe("Fish Finder surfaces — behaviour kept through the redesign", () => {
  it("FishFinder keeps the tab hand-offs, deep links and toggle chips", () => {
    expect(FINDER).toMatch(/aquadex:navigate-tab/);
    expect(FINDER).toMatch(/tab: "tanks"/);
    expect(FINDER).toMatch(/tab: "directory"/);
    expect(FINDER).toMatch(/deepLinkSpecies=\{deepLinkSpecies\}/);
    expect(FINDER).toMatch(/initialSelectedBreed=\{initialSelectedBreed\}/);
    expect(FINDER).toMatch(/onSelectedBreedChange=\{onSelectedBreedChange\}/);
    expect(FINDER).toMatch(/preselectedBreedId=\{effectivePreselectedBreedId\}/);
    expect(FINDER).toMatch(/aria-pressed=\{active\}/);
    expect(FINDER).toMatch(/window\.scrollTo\(0, 0\)/);
    expect(FINDER).toMatch(/ref=\{browseSectionRef\}/);
  });

  it("FishFinder still ranks with the shared fit engine", () => {
    expect(FINDER).toMatch(/rankSpeciesMatches\(/);
    expect(FINDER).toMatch(/filterByIntent\(/);
    expect(FINDER).toMatch(/filterByWater\(/);
  });

  it("the species detail still composes the fit engine and the tab hand-offs", () => {
    expect(DETAIL).toMatch(/assessSpeciesFit\(/);
    expect(DETAIL).toMatch(/fitPresentationKind\(/);
    expect(DETAIL).toMatch(/VERDICT_CHIP\[/);
    expect(DETAIL).toMatch(/tab: "tanks"/);
    expect(DETAIL).toMatch(/tab: "directory"/);
    expect(DETAIL).toMatch(/<PoseidonChatConsole/);
  });
});
