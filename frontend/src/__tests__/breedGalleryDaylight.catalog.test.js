/**
 * Source guards for the Breed Gallery Daylight rework (SpeciesCardPremium,
 * then the BreedGallery list and species detail).
 *
 * vitest runs in a `node` environment here (no jsdom), and both components
 * pull in browser-only modules, so, like BreederTerminal.catalog.test.js, this
 * checks the comment-stripped source and stylesheet. Real keyboard and screen
 * reader behaviour still needs a manual pass with assistive technology.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const CARD_RAW = read("../components/SpeciesCardPremium.jsx");
const CARD = stripComments(CARD_RAW);
const CARD_CSS = read("../components/SpeciesCardPremium.css");

describe("SpeciesCardPremium: Daylight card", () => {
  it("imports its scoped stylesheet and Phosphor icons", () => {
    expect(CARD).toContain('import "./SpeciesCardPremium.css";');
    expect(CARD).toMatch(/import \{[^}]*\bHeart\b[^}]*\} from "@phosphor-icons\/react"/);
  });

  it("keeps the old class names and adds the bgal-card root", () => {
    expect(CARD).toMatch(/className=\{`bgal-card species-card-premium\$\{isOwned \? " card-owned" : ""\}/);
  });

  it("makes the name a real button that opens the card through the root click", () => {
    expect(CARD).toContain('<button type="button" className="bgal-card__open">{breed.commonName}</button>');
    // No handler of its own: the click bubbles to the root onSelect once.
    const open = CARD.slice(CARD.indexOf('className="bgal-card__open"') - 40, CARD.indexOf('className="bgal-card__open"') + 60);
    expect(open).not.toContain("onClick");
    expect(CARD).toContain("onClick={onSelect}");
  });

  it("makes the easter-egg badge a keyboard-reachable button that stops propagation", () => {
    const idx = CARD.indexOf('className="bgal-card__egg"');
    expect(idx).toBeGreaterThan(-1);
    const before = CARD.slice(Math.max(0, idx - 60), idx);
    expect(before).toContain('<button\n            type="button"');
    const block = CARD.slice(idx, idx + 300);
    expect(block).toContain("e.stopPropagation();");
    expect(block).toContain("onEasterEgg && onEasterEgg(eggConfig);");
  });

  it("keeps the verdict colour off the chip text (ring and dot only)", () => {
    expect(CARD).toContain("style={{ borderColor: verdictChip.border }}");
    expect(CARD).toContain('<span className="bgal-card__dot" style={{ background: verdictChip.color }} aria-hidden="true" />');
    expect(CARD).not.toContain("color: verdictChip.color");
  });

  it("uses text-safe kept-ribbon tier classes instead of inline gold", () => {
    expect(CARD).toContain("bgal-card__kept--${masteryTier}");
    expect(CARD).not.toMatch(/#ffd700/i);
    expect(CARD_CSS).toMatch(/\.bgal-card__kept--gold\s*\{[^}]*color:\s*#854d0e/);
  });

  it("uses no emoji glyphs or em dashes in its own copy", () => {
    for (const glyph of ["♥", "♡", "🥇", "🥈", "🥉", "🥚", "🌡️", "💧", "📐", "📜", "✓", "—"]) {
      expect(CARD, `unexpected ${glyph}`).not.toContain(glyph);
    }
  });

  it("uses the plain card copy", () => {
    expect(CARD).toContain("In your tanks ({ownedCount})");
    expect(CARD).toContain("{breed.specimenCount} certificates");
    expect(CARD).toContain('"See available fish"');
    expect(CARD).toContain('"Learn more"');
    expect(CARD).toContain('"View certificates"');
    expect(CARD).toContain('"Gold mastery: full lifecycle"');
    expect(CARD).not.toContain("Propose to Catalog");
  });

  it("still re-exports VERDICT_CHIP from the fit engine", () => {
    expect(CARD).toContain('export { VERDICT_CHIP } from "../services/speciesFit";');
  });

  it("scopes every stylesheet rule under the card root or a bgal-card element", () => {
    expect(CARD_CSS).toContain(".bgal-card.species-card-premium");
    const selectors = stripComments(CARD_CSS)
      .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "")
      .match(/(^|\})\s*([^{}@]+)\{/g)
      .map((m) => m.replace(/^\}/, "").replace(/\{$/, "").trim())
      .flatMap((s) => s.split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(10);
    for (const sel of selectors) {
      expect(sel, sel).toMatch(/^\.bgal-card(\.species-card-premium|__)/);
    }
  });

  it("gives the wishlist heart a 44px hit area", () => {
    expect(CARD_CSS).toMatch(
      /\.bgal-card\.species-card-premium \.species-card-premium__wishlist\s*\{[^}]*height:\s*(4[4-9]|[5-9]\d)px/
    );
    expect(CARD_CSS).toMatch(/button\.species-card-premium__cta\s*\{[^}]*min-height:\s*44px/);
  });

  it("drops the invisible difficult-tier shimmer and honours reduced motion", () => {
    expect(CARD_CSS).toMatch(/\.tier-difficult::before\s*\{\s*display:\s*none;?\s*\}/);
    expect(CARD_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
  });
});

const GALLERY_RAW = read("../components/BreedGallery.jsx");
const GALLERY = stripComments(GALLERY_RAW);
const GALLERY_CSS = read("../components/BreedGalleryDaylight.css");

// The list view is everything after the Pro detail return.
const LIST = GALLERY.slice(GALLERY.indexOf("const viewTabs = proMode"));

describe("BreedGallery list: Daylight header, tabs, filters and states", () => {
  it("imports its scoped stylesheet, the tab-key helper and Phosphor icons", () => {
    expect(GALLERY).toContain('import "./BreedGalleryDaylight.css";');
    expect(GALLERY).toContain('import { nextTabIndex } from "./breedGalleryTabs";');
    expect(GALLERY).toMatch(/import \{[^}]*\bSlidersHorizontal\b[^}]*\} from "@phosphor-icons\/react"/);
  });

  it("wraps the list and the early error state in the .bgal root", () => {
    expect(LIST).toContain('<div className="bgal">');
    expect(GALLERY).toMatch(/if \(error\) \{\s*return \(\s*<div className="bgal">\s*<div className="bgal-state bgal-state--error" role="alert">/);
  });

  it("shows the Breed Gallery header in Pro only", () => {
    expect(LIST).toMatch(/\{proMode && \(\s*<header className="bgal-head">/);
    expect(LIST).toContain('<h2 className="bgal-title">Breed Gallery</h2>');
  });

  it("renders the view modes as one ARIA tablist with a tabpanel", () => {
    expect((GALLERY.match(/role="tablist"/g) || []).length).toBeGreaterThanOrEqual(1);
    expect(LIST).toContain('role="tab"');
    expect(LIST).toContain("aria-selected={selected}");
    expect(LIST).toContain('aria-controls="bgal-view-panel"');
    expect(LIST).toContain("tabIndex={index === activeViewIndex ? 0 : -1}");
    expect(LIST).toContain('role="tabpanel" id="bgal-view-panel"');
    expect(LIST).toContain("nextTabIndex(e.key, activeViewIndex, viewTabs.length)");
    expect(LIST).toContain("viewTabs[next].activate();");
  });

  it("uses the plain tab labels", () => {
    for (const label of ['"In my tanks"', '"Registered breeds"', '"All species"', '"My collection"', '"Review queue"']) {
      expect(LIST, label).toContain(label);
    }
  });

  it("makes the filter options aria-pressed chip buttons", () => {
    expect(LIST).toContain("aria-pressed={isActive}");
    expect(LIST).not.toContain('className={isActive ? "btn-primary" : "btn-secondary"}');
    expect(LIST).toContain('aria-expanded={filtersOpen}');
    expect(LIST).toContain('aria-controls="bgal-filter-panel"');
    expect(LIST).toContain('role="group"');
  });

  it("keeps the phone bottom-sheet classes and the pinned option arrays", () => {
    expect(GALLERY).toContain("breed-filter-panel");
    expect(GALLERY).toContain("breed-filter-backdrop");
    expect(GALLERY).toContain('className="breed-filter-apply-btn bgal-btn bgal-btn--primary"');
    expect(GALLERY_RAW).toContain('{ val: "Coral", label: "Corals" }');
    expect(LIST).toContain("Show {filteredSpecies.length} results");
  });

  it("gives tabs and chips at least a 44px target", () => {
    expect(GALLERY_CSS).toMatch(/\.bgal-tab\s*\{[^}]*min-height:\s*4[4-9]px/);
    expect(GALLERY_CSS).toMatch(/\.bgal-chip\s*\{[^}]*min-height:\s*44px/);
    expect(GALLERY_CSS).toMatch(/\.bgal-btn\s*\{[^}]*min-height:\s*44px/);
  });

  it("strips the sky-blue gradients, dead Tailwind text and emoji labels", () => {
    expect(GALLERY).not.toContain("rgba(56, 189, 248, 0.15) 0%, rgba(14, 165, 233, 0.25)");
    // The detail's dead Tailwind classes go in FEAT-003; the list has none.
    expect(LIST).not.toContain("bg-white/[");
    expect(GALLERY).not.toContain("⚡ Suggest Species");
    expect(GALLERY).not.toContain("Register First Specimen 🐠");
    expect(LIST).not.toContain("WebkitTextFillColor");
    for (const old of ["🐠 My Tank Species", "🌐 All Catalog Breeds", "🌍 Global Database", "🛠️ Curation Queue", "🎛️", "📷", "🔱", "CURATION QUEUE", "Filters & Refinement", "Apply Filters ("]) {
      expect(LIST, old).not.toContain(old);
    }
  });

  it("uses no em dashes or exclamation points in list copy outside the easter eggs", () => {
    // The lore dialog and evolving overlay keep their easter-egg copy (D10).
    const listCopy = LIST.slice(0, LIST.indexOf("{activeLoreEgg && ("));
    expect(listCopy).not.toContain("—");
    // JSX text nodes only (skip runs of JS between tags such as `&& !x ? (`).
    const jsxText = (listCopy.match(/>[^<>{}]*</g) || []).filter((t) => !/[=&|?()]/.test(t));
    expect(jsxText.length).toBeGreaterThan(10);
    for (const t of jsxText) expect(t, t).not.toContain("!");
  });

  it("labels the icon-only buttons", () => {
    expect(LIST).toContain('aria-label="Search species"');
    expect(LIST).toContain('aria-label="Clear search"');
    expect(LIST).toContain('aria-label="Clear this search"');
    expect(LIST).toContain('aria-label="Remove photo"');
  });

  it("gives the lore dialog a dialog role, Escape to close and a focused Close button", () => {
    expect(LIST).toContain('role="dialog"');
    expect(LIST).toContain('aria-modal="true"');
    expect(LIST).toContain('aria-labelledby="bgal-egg-title"');
    expect(LIST).toMatch(/if \(e\.key === "Escape"\) \{\s*setActiveLoreEgg\(null\);\s*setEvolutionError\(""\);/);
    expect(LIST).toMatch(/className="bgal-btn"\s*autoFocus/);
  });

  it("shows the suggestion notification as a status message", () => {
    expect(LIST).toContain('<div className="bgal-toast" role="status">');
    expect(LIST).toContain("<strong>Suggestion sent</strong>");
    expect(LIST).toContain("to the review queue.");
  });

  it("keeps the grid scroller ref and starry toggle on the new class", () => {
    expect(LIST).toContain("ref={parentRefCallback}");
    expect(LIST).toContain('className={"bgal-grid-scroller" + (starryBgActive ? " starry-grid-overlay" : "")}');
    expect(LIST).toContain("ref={rowVirtualizer.measureElement}");
  });

  it("insets the filter card inside the phone bottom sheet", () => {
    expect(GALLERY_CSS).toMatch(/\.breed-filter-panel \.bgal-filters\s*\{\s*border:\s*none;\s*background:\s*none;\s*padding:\s*0;\s*box-shadow:\s*none;?\s*\}/);
  });
});

describe("BreedGallery: Casual hand-off stays untouched", () => {
  it("still returns CasualSpeciesDetail before any bgal markup", () => {
    const start = GALLERY_RAW.indexOf("if (casualModeActive) {");
    const end = GALLERY_RAW.indexOf("onBack={() => setSelectedBreed(null)}", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(GALLERY_RAW.slice(start, end)).toContain("<CasualSpeciesDetail");
    const selectedStart = GALLERY_RAW.lastIndexOf("if (selectedBreed) {", start);
    expect(selectedStart).toBeGreaterThan(-1);
    expect(GALLERY_RAW.slice(selectedStart, end)).not.toContain('className="bgal');
  });
});

// Species detail assertions: added by FEAT-003.
