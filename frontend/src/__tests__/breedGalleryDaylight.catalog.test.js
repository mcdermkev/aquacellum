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

// List view assertions: added by FEAT-002.
// Species detail assertions: added by FEAT-003.
