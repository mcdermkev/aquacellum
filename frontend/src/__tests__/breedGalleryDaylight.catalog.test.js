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
    expect(CARD).toContain('{breed.specimenCount} {breed.specimenCount === 1 ? "certificate" : "certificates"}');
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
    // View modes, detail records and care guide.
    expect((GALLERY.match(/role="tablist"/g) || []).length).toBeGreaterThanOrEqual(3);
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
    expect(LIST).toContain('Show {filteredSpecies.length} {filteredSpecies.length === 1 ? "result" : "results"}');
  });

  it("gives tabs and chips at least a 44px target", () => {
    expect(GALLERY_CSS).toMatch(/\.bgal-tab\s*\{[^}]*min-height:\s*4[4-9]px/);
    expect(GALLERY_CSS).toMatch(/\.bgal-chip\s*\{[^}]*min-height:\s*44px/);
    expect(GALLERY_CSS).toMatch(/\.bgal-btn\s*\{[^}]*min-height:\s*44px/);
  });

  it("strips the sky-blue gradients, dead Tailwind text and emoji labels", () => {
    expect(GALLERY).not.toContain("rgba(56, 189, 248, 0.15) 0%, rgba(14, 165, 233, 0.25)");
    expect(GALLERY).not.toContain("bg-white/[");
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

  it("keeps Tab and Shift+Tab inside the lore dialog", () => {
    expect(LIST).toContain('if (e.key === "Tab") {');
    expect(LIST).toContain("e.currentTarget.querySelectorAll(");
    expect(LIST).toMatch(/e\.shiftKey && document\.activeElement === first\) \{\s*e\.preventDefault\(\);\s*last\.focus\(\);/);
    expect(LIST).toMatch(/!e\.shiftKey && document\.activeElement === last\) \{\s*e\.preventDefault\(\);\s*first\.focus\(\);/);
  });

  it("puts the fit score on a near-white panel so muted and amber text pass AA", () => {
    const rule = GALLERY_CSS.match(/\.bgal-sim-score\s*\{[^}]*\}/)[0];
    expect(rule).toContain("background: #f8fbfc;");
    expect(rule).not.toContain("var(--bg-band)");
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

// The Pro species detail: after the Casual hand-off, before the list view.
const DETAIL = GALLERY.slice(
  GALLERY.indexOf("const { score, color, text, minVol, verdict, reasons } = compatibility;"),
  GALLERY.indexOf("const viewTabs = proMode")
);

describe("BreedGallery species detail: Daylight layout, tabs and plain copy", () => {
  it("finds the Pro detail block", () => {
    expect(DETAIL.length).toBeGreaterThan(1000);
    expect(DETAIL).toContain('<div className="bgal bgal-detail">');
  });

  it("drops the dark hero overlay, inline Outfit font and emoji labels", () => {
    expect(GALLERY).not.toContain("linear-gradient(to top, rgba(10,15,30,0.95)");
    expect(GALLERY).not.toContain("fontFamily: \"'Outfit', sans-serif\"");
    expect(GALLERY).not.toContain("🐠 View Details");
    for (const glyph of ["🎮", "📋", "🛡️", "🟢", "🔴", "⚪", "⚠️", "🌿", "✅", "👍", "🚫", "—"]) {
      expect(DETAIL, `unexpected ${glyph}`).not.toContain(glyph);
    }
    expect(GALLERY).not.toContain("species-detail__tabs");
  });

  it("puts a white caption strip with a readable photo credit under the hero", () => {
    expect(DETAIL).toContain('<figure className="bgal-hero">');
    expect(DETAIL).toContain('<figcaption className="bgal-hero-caption">');
    expect(DETAIL).toContain('<span className="bgal-hero-badge">Catalog photo</span>');
    expect(DETAIL).toContain('style={{ color: "var(--text-muted)", textAlign: "right" }}');
  });

  it("keeps the verdict colours unchanged on the ring and uses text-safe colours for text", () => {
    for (const hsl of ['ok: "hsl(140, 70%, 45%)"', 'caution: "hsl(42, 92%, 52%)"', 'blocked: "hsl(0, 78%, 55%)"', 'no_tank: "hsl(210, 10%, 55%)"']) {
      expect(GALLERY, hsl).toContain(hsl);
    }
    expect(DETAIL).toContain("stroke={color}");
    expect(GALLERY).toContain('const VERDICT_TEXT = Object.freeze({');
    expect(GALLERY).toContain('ok: "var(--accent-green)"');
    expect(DETAIL).toContain('<span className="bgal-ring-value" style={{ color: verdictText }}>');
    expect(DETAIL).toContain('<strong className="bgal-sim-verdict" style={{ color: verdictText }}>');
    expect(DETAIL).not.toContain("textShadow");
    expect(DETAIL).not.toContain("${color}30");
  });

  it("orders the care guide before the two columns in the DOM (no flex order hacks)", () => {
    const guide = DETAIL.indexOf('<section className="bgal-guide"');
    const main = DETAIL.indexOf('<div className="bgal-main">');
    const side = DETAIL.indexOf('<aside className="bgal-side"');
    expect(guide).toBeGreaterThan(DETAIL.indexOf('<div className="bgal-detail-grid">'));
    expect(main).toBeGreaterThan(guide);
    expect(side).toBeGreaterThan(main);
    expect(DETAIL).not.toMatch(/order:\s*\d/);
  });

  it("renders the records sub-tabs as an ARIA tablist with a tabpanel", () => {
    expect(DETAIL).toContain('aria-label="Species records"');
    expect(DETAIL).toContain("id={`bgal-sub-tab-${id}`}");
    expect(DETAIL).toContain('aria-controls="bgal-sub-panel"');
    expect(DETAIL).toContain("tabIndex={index === activeSubIndex ? 0 : -1}");
    expect(DETAIL).toContain('role="tabpanel"\n              id="bgal-sub-panel"');
    expect(DETAIL).toContain("nextTabIndex(e.key, activeSubIndex, subTabs.length)");
    expect(DETAIL).toContain("setSelectedSubTab(subTabs[next].id);");
  });

  it("renders the care guide tabs as an ARIA tablist with a tabpanel", () => {
    expect(DETAIL).toContain('aria-label="Care guide sections"');
    expect(DETAIL).toContain("id={`bgal-guide-tab-${id}`}");
    expect(DETAIL).toContain('aria-controls="bgal-guide-panel"');
    expect(DETAIL).toContain('id="bgal-guide-panel"');
    expect(DETAIL).toContain("nextTabIndex(e.key, activeGuideIndex, guideTabs.length)");
    expect(DETAIL).toContain("setActiveInfoTab(guideTabs[next].id);");
  });

  it("makes 'Only my fish' one aria-pressed toggle", () => {
    expect(DETAIL).toContain("aria-pressed={showMyFishOnly}");
    expect(DETAIL).toContain("Only my fish");
    expect(DETAIL).not.toContain("Show My Fish Only");
  });

  it("opens certificate cards from a stretched title button with no handler of its own", () => {
    expect(DETAIL).toContain('<button type="button" className="bgal-cert-open">');
    const open = DETAIL.slice(DETAIL.indexOf('className="bgal-cert-open"'), DETAIL.indexOf('className="bgal-cert-open"') + 200);
    expect(open).not.toContain("onClick");
    expect(DETAIL).toContain("onClick={() => onSelectSpecimen && onSelectSpecimen(spec.specimenId)}");
    expect(GALLERY_CSS).toMatch(/\.bgal-cert-open::after\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0/);
  });

  it("keeps the specimen photo line and labels the species photo honestly", () => {
    expect(GALLERY_RAW).toContain("const finalImgSrc = customPhoto || masterPhotoUrl");
    expect(DETAIL).toContain("{!customPhoto && masterPhotoUrl && (");
    expect(DETAIL).toContain("Species photo");
    expect(DETAIL).not.toContain("Breeder-Verified Master Stock");
    expect(DETAIL).not.toContain("Verified Master Photo");
    expect(DETAIL).toContain('"Not recorded"');
    expect(DETAIL).not.toContain("Wild-Caught / Unknown");
  });

  it("makes the stock tag controls labelled buttons that do not open the card", () => {
    expect(DETAIL).toContain('aria-label="Stock tag"');
    expect(DETAIL).toContain('className="bgal-tag"');
    expect(DETAIL).toContain("aria-label={`Edit stock tag ${spec.breederStockTag}`}");
    expect(DETAIL).toContain('className="bgal-tag-add"');
    expect(DETAIL).toContain("Add tag");
    expect(DETAIL).toMatch(/className="bgal-tag-edit"\s*onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
    expect(GALLERY_CSS).toMatch(/\.bgal-tag-edit\s*\{[^}]*z-index:\s*2/);
  });

  it("keeps the family tree action from opening the card", () => {
    expect(DETAIL).toMatch(/e\.stopPropagation\(\);\s*onViewLineage\(spec\.specimenId\);/);
    expect(DETAIL).toContain("View family tree");
    expect(GALLERY_CSS).toMatch(/\.bgal-cert-actions \.bgal-btn\s*\{[^}]*z-index:\s*2/);
  });

  it("labels the range inputs and gives them a value text", () => {
    for (const id of ["volume", "ph", "temp"]) {
      expect(DETAIL).toContain(`<label htmlFor="bgal-sim-${id}">`);
      expect(DETAIL).toContain(`id="bgal-sim-${id}"`);
    }
    expect((DETAIL.match(/aria-valuetext=/g) || []).length).toBe(3);
    expect(DETAIL).not.toContain("premium-slider");
    expect(GALLERY_CSS).toMatch(/\.bgal-range\s*\{[^}]*height:\s*44px/);
  });

  it("uses Phosphor icons hidden from assistive tech for the parameter check", () => {
    expect(DETAIL).toContain('<CheckCircle size={18} weight="fill" className="bgal-check-icon" aria-hidden="true" />');
    expect(DETAIL).toContain('<XCircle size={18} weight="fill" className="bgal-check-icon" aria-hidden="true" />');
    expect(DETAIL).toContain('<MinusCircle size={18} className="bgal-check-icon" aria-hidden="true" />');
    expect(DETAIL).toContain("className={`bgal-check bgal-check--${volumeCheck}`}");
  });

  it("moves the tankmates row styling onto ScrollFade's className", () => {
    expect(DETAIL).toContain('className="bgal-mates-row"');
    expect(DETAIL).toContain('aria-label="Compatible tankmates"');
  });

  it("uses the plain detail copy", () => {
    for (const s of [
      "Back to species",
      "Suggest for the catalog",
      "Minimum tank",
      "Spawning records",
      "Listings for this species",
      "Check your tank",
      "Fit score",
      '"Good fit"',
      '"Not a fit"',
      "Parameter check",
      "Tank is big enough (",
      "Tankmates that match",
      "No species with recorded ranges match these settings.",
      "Care guide",
      "Natural habitat",
      "Temperament and tankmates",
      "How to feed",
      "Spawning setup",
      "Breeding notes",
    ]) {
      expect(DETAIL, s).toContain(s);
    }
    for (const old of ["Back to Species List", "Propose Breed to Active Catalog", "Cert. Serial No.", "Trace Ancestry Family Tree", "Simulate My Tank", "Compatibility Score", "Verified Safe Companions", "Species Care Guide", "Care Blueprint", "Biotope Origin", "+ Tag"]) {
      expect(DETAIL, old).not.toContain(old);
    }
  });

  it("gives the detail panels white cards and the 900px one-column collapse", () => {
    expect(GALLERY_CSS).toMatch(/\.bgal-detail-grid\s*\{[^}]*grid-template-areas:/);
    expect(GALLERY_CSS).toMatch(/@media \(max-width: 900px\)\s*\{\s*\.bgal-detail-grid/);
    expect(GALLERY_CSS).toMatch(/\.bgal \.badge\s*\{\s*font-size:\s*0?\.8rem;\s*padding:\s*0?\.35rem 0?\.75rem;?\s*\}/);
  });
});
