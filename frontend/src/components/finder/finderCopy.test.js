/**
 * Casual Fish Finder copy invariants (Fish Finder Rework, Task 10).
 *
 * Two contracts, enforced by test rather than by vigilance:
 *   1. Web2 language — no PROHIBITED_TERMS, reusing the canonical checker in
 *      services/orderCopy.js (same style as __tests__/orderCopy.test.js and
 *      __tests__/listingFlowCopy.test.js).
 *   2. One Casual vocabulary — the keeper's setup is a "tank" everywhere. This
 *      is the drift T10 fixed: the finder previously rendered "Add an
 *      aquarium…" directly above "Add a tank →". "Tank" is canonical because
 *      it's what keepers say and it's already the noun in the fit engine's
 *      generated verdicts, which are the most prominent copy on every card.
 *
 * Source guards at the bottom keep the components consuming this module, so a
 * future inline string can't quietly reintroduce either problem.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { containsProhibitedTerm } from "../../services/orderCopy.js";
import { VERDICT_CHIP } from "../../services/speciesFit.js";
import {
  CONTAINER_NOUN,
  CONTAINER_NOUN_PLURAL,
  FINDER_COPY,
  DETAIL_COPY,
  usesOffVocabulary,
} from "./finderCopy.js";

/** Every user-visible string this module can produce, formatters resolved. */
function allCopyStrings() {
  const c = FINDER_COPY;
  const d = DETAIL_COPY;
  return [
    // Context bar
    c.contextBar.label,
    c.contextBar.pickerAria,
    c.contextBar.loadingAria,
    c.contextBar.emptyText,
    c.contextBar.emptyCta,
    c.contextBar.unnamed,
    // Dex
    c.dex.title,
    c.dex.emptyHint,
    c.dex.keptLabel,
    c.dex.wishlistCount(3),
    c.dex.catalogShare(42),
    c.dex.progressAria,
    // Discovery
    c.discovery.title,
    c.discovery.chipsAria,
    c.discovery.searchPlaceholder,
    c.discovery.searchAria,
    c.discovery.clear,
    c.discovery.clearFilters,
    // Results
    c.results.title,
    c.results.loadingAria,
    c.results.empty,
    // Home
    c.home.title("The Living Room"),
    c.home.titleFallback,
    c.home.fallbackName,
    c.home.loadingAria,
    c.home.needTank,
    c.home.chooseTank,
    c.home.empty,
    // Browse
    c.browse.title,
    // Toast
    c.toast.dexAddedOne("Neon Tetra", 15),
    c.toast.dexAddedMany(3, 45),
    // Detail
    d.fitTitle,
    d.careTitle,
    d.stockingTitle,
    d.contextBar.pickerLabel,
    d.contextBar.pickerAria,
    d.contextBar.unnamed,
    d.emptyFit("this fish"),
    d.emptyFitCta,
    d.stockingImpact("this fish", "The Living Room", 68, 41),
    d.stockingUnknown,
    d.fallbackName,
    // Verdict chip labels are the most prominent copy on a card, so they're
    // held to the same contract (T11 moved them to services/speciesFit.js).
    ...Object.values(VERDICT_CHIP).map((chip) => chip.label),
  ];
}

describe("Fish Finder copy — Web2 language invariant", () => {
  it("no user-visible string contains a prohibited Web3 term", () => {
    for (const text of allCopyStrings()) {
      expect(containsProhibitedTerm(text), `string: "${text}"`).toBe(false);
    }
  });

  it("every string is non-empty and trimmed", () => {
    for (const text of allCopyStrings()) {
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
      expect(text).toBe(text.trim());
    }
  });
});

describe("Fish Finder copy — one Casual vocabulary", () => {
  it("calls the keeper's setup a tank", () => {
    expect(CONTAINER_NOUN).toBe("tank");
    expect(CONTAINER_NOUN_PLURAL).toBe("tanks");
  });

  it("never says \"aquarium\" in user-visible copy", () => {
    for (const text of allCopyStrings()) {
      expect(usesOffVocabulary(text), `string: "${text}"`).toBe(false);
    }
  });

  it("usesOffVocabulary flags the drift it exists to catch, and only that", () => {
    expect(usesOffVocabulary("Add an aquarium →")).toBe(true);
    expect(usesOffVocabulary("Does it fit your aquarium?")).toBe(true);
    expect(usesOffVocabulary("Loading your aquariums")).toBe(true);
    // The canonical wording must pass, including words that merely contain a
    // banned term as a substring.
    expect(usesOffVocabulary("Add a tank →")).toBe(false);
    expect(usesOffVocabulary("Nano / small tanks")).toBe(false);
    expect(usesOffVocabulary("Choose a tank to match against")).toBe(false);
  });

  it("uses the canonical noun in the strings a keeper actually reads first", () => {
    expect(FINDER_COPY.contextBar.emptyCta).toContain("tank");
    expect(FINDER_COPY.contextBar.emptyText).toContain("tank");
    expect(FINDER_COPY.home.titleFallback).toContain("tank");
    expect(DETAIL_COPY.fitTitle).toContain("tank");
    expect(DETAIL_COPY.emptyFitCta).toContain("tank");
  });

  it("agrees with the fit engine's generated verdicts, which also say tank", () => {
    // The whole point of choosing "tank": the chrome copy and the engine's
    // headline no longer disagree on the same card.
    expect(DETAIL_COPY.fitTitle).toContain(CONTAINER_NOUN);
    expect(FINDER_COPY.home.titleFallback).toContain(CONTAINER_NOUN);
  });
});

describe("Fish Finder copy — empty states lead somewhere", () => {
  it("the home dead end names the likely causes and offers a next step", () => {
    const text = FINDER_COPY.home.empty;
    // Honest: doesn't assert a single cause it can't know.
    expect(text).toMatch(/already live here/i);
    expect(text).toMatch(/different water/i);
    // Actionable: points at the browse grid that's right below it.
    expect(text).toMatch(/browse all species/i);
  });

  it("the results dead end blames the filter, not the catalog, and offers a way out", () => {
    expect(FINDER_COPY.results.empty).toMatch(/filter|search/i);
    expect(FINDER_COPY.results.empty).not.toMatch(/no species|empty catalog/i);
  });

  it("names the browse section the home empty state points to", () => {
    // Keeps the cross-reference honest: the empty state says "Browse all
    // species", so that must be what the section is actually titled.
    expect(FINDER_COPY.home.empty.toLowerCase()).toContain(
      FINDER_COPY.browse.title.toLowerCase()
    );
  });
});

describe("Fish Finder copy — components consume this module", () => {
  // Comments are stripped before guarding (the convention in
  // __tests__/localBreederMapPickups.catalog.test.js): a JSX comment that
  // quotes a section title for readability is not rendered copy, and shouldn't
  // trip a check aimed at inlined strings.
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const read = (rel) =>
    stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

  const SURFACES = {
    "FishFinder.jsx": read("./FishFinder.jsx"),
    "MyDexPanel.jsx": read("./MyDexPanel.jsx"),
    "CasualSpeciesDetail.jsx": read("./CasualSpeciesDetail.jsx"),
  };

  it("each finder surface imports the shared copy module", () => {
    for (const [name, src] of Object.entries(SURFACES)) {
      expect(src, name).toMatch(/from "\.\/finderCopy"|from "\.\.\/finder\/finderCopy"/);
    }
  });

  it("no finder surface still renders a hardcoded container-noun literal", () => {
    // These must come from finderCopy, not be inlined — that's how the two
    // nouns diverged in the first place.
    const RETIRED = ['"Add a tank →"', '"Unnamed Tank"', '"Does it fit your tank?"', "Add an aquarium"];
    for (const [name, src] of Object.entries(SURFACES)) {
      for (const literal of RETIRED) {
        expect(src.includes(literal), `${name} still contains: ${literal}`).toBe(false);
      }
    }
  });
});
