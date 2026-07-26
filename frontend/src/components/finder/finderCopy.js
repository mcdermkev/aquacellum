/**
 * finderCopy.js — the single source of Casual Fish Finder language
 * (Fish Finder Rework, Task 10).
 *
 * T5–T9 built the finder surfaces with their copy inlined in JSX, which let
 * two kinds of drift in:
 *
 *   1. VOCABULARY DRIFT. The Casual nav calls a keeper's setup an "aquarium"
 *      ("My Aquariums", App.jsx tab label), but the finder said "tank" — often
 *      in adjacent lines of the same block ("Add an aquarium to get matches…"
 *      directly above "Add a tank →"). See CONTAINER_NOUN below.
 *   2. THIN EMPTY STATES. Dead ends like "No matches to show yet." named no
 *      cause and offered no next step.
 *
 * This module centralizes every user-visible finder string so the vocabulary
 * is enforceable by test (finderCopy.test.js) instead of by vigilance, matching
 * the established copy-module convention (services/orderCopy.js, the
 * onboarding *Copy.js modules).
 *
 * Pure and dependency-free — strings and small formatters only, no React, no
 * state, no I/O.
 */

// ─── Canonical Casual vocabulary ────────────────────────────────────────────
//
// CONTAINER_NOUN: "aquarium", not "tank".
//
// Casual mode's own navigation is the tiebreaker — App.jsx labels the tab
// `casualModeActive ? "My Aquariums" : "Aquariums"`, so a Casual keeper is
// already reading "aquarium" everywhere else in the shell. "Tank" stays in
// PROP and VARIABLE names (displayTank, selectedTankId, tankFitInputs) because
// that's the internal data model and renaming it is out of T10's scope — this
// is a user-facing-copy contract only.
export const CONTAINER_NOUN = "aquarium";
export const CONTAINER_NOUN_PLURAL = "aquariums";

// Terms that must never appear in Casual finder copy. "tank" is here for the
// alignment reason above; the Web3 terms are covered separately and
// canonically by orderCopy.PROHIBITED_TERMS, which the test also applies.
export const OFF_VOCABULARY_TERMS = Object.freeze(["tank", "specimen", "taxonomy", "breeder-grade"]);

/**
 * Whether a string uses off-vocabulary Casual wording (case-insensitive).
 * Matches whole words so "aquarium" isn't flagged and legitimate compounds
 * aren't caught by a naive substring test.
 * @param {string} text
 * @returns {boolean}
 */
export function usesOffVocabulary(text) {
  const lower = String(text || "").toLowerCase();
  return OFF_VOCABULARY_TERMS.some((term) => new RegExp(`\\b${term}s?\\b`).test(lower));
}

// ─── Fish Finder surface ────────────────────────────────────────────────────

export const FINDER_COPY = Object.freeze({
  // Aquarium context bar (FishFinder)
  contextBar: Object.freeze({
    label: "Matching against",
    pickerAria: "Choose an aquarium to match against",
    loadingAria: "Loading your aquariums",
    emptyText: "Add an aquarium to get fish picked for your water.",
    emptyCta: "Add an aquarium →",
    unnamed: "Unnamed aquarium",
  }),

  // "My Dex" collection panel (MyDexPanel)
  dex: Object.freeze({
    title: "My Dex",
    emptyHint: "Every species you keep gets logged here. Add a fish to start your Dex.",
    keptLabel: "species kept",
    /** @param {number} n */
    wishlistCount: (n) => `${n} wishlisted`,
    /** @param {number} percent */
    catalogShare: (percent) => `${percent}% of the catalog`,
    progressAria: "Dex completion",
  }),

  // Guided discovery (FishFinder, T7)
  discovery: Object.freeze({
    title: "Find my next fish",
    chipsAria: "Discovery filters",
    searchPlaceholder: "Search by name…",
    searchAria: "Search species by name",
    clear: "Clear",
    clearFilters: "Clear filters",
  }),

  // Discovery results grid
  results: Object.freeze({
    title: "Results",
    loadingAria: "Finding species",
    // Names the cause (the active filter/search, not the catalog) and leaves
    // the clear affordance to do the work.
    empty: "Nothing matched that. Try a different filter, or clear your search.",
  }),

  // "Good matches" home
  home: Object.freeze({
    /** @param {string} aquariumName */
    title: (aquariumName) => `Good matches for ${aquariumName}`,
    titleFallback: "Good matches for your aquarium",
    fallbackName: "your aquarium",
    loadingAria: "Finding matches",
    // No aquariums at all yet.
    needAquarium: "Add an aquarium above to see fish picked for your water.",
    // Aquariums exist but none is selected (guard — the bar auto-selects).
    chooseAquarium: "Choose an aquarium above to see matches picked for your water.",
    // Honest dead end: state both plausible causes without asserting either,
    // then hand the keeper somewhere to go.
    empty:
      "No matches to show for this aquarium yet — the species we checked either " +
      "already live here or need different water. Browse all species below to keep looking.",
  }),

  browse: Object.freeze({
    title: "Browse all species",
  }),

  // Dex award toast. Points are passed in from XP_ACTIONS so the number shown
  // can never drift from the number granted.
  toast: Object.freeze({
    /** @param {string} commonName @param {number} points */
    dexAddedOne: (commonName, points) => `🎉 ${commonName} added to your Dex! +${points} pts`,
    /** @param {number} count @param {number} points */
    dexAddedMany: (count, points) => `🎉 ${count} new species added to your Dex! +${points} pts`,
  }),
});

// ─── Casual species detail surface ──────────────────────────────────────────

export const DETAIL_COPY = Object.freeze({
  fitTitle: "Does it fit your aquarium?",
  careTitle: "Care needs",
  stockingTitle: "Stocking impact",

  contextBar: Object.freeze({
    pickerLabel: "Matching against",
    pickerAria: "Choose an aquarium to match against",
    unnamed: "Unnamed aquarium",
  }),

  /** @param {string} subjectWord — e.g. "this fish" / the species' name */
  emptyFit: (subjectWord) => `Add an aquarium to check whether ${subjectWord} fits your water.`,
  emptyFitCta: "Add an aquarium →",

  /**
   * Full stocking sentence, so the whole claim lives in one place rather than
   * being split across JSX lines.
   * @param {string} subjectWord @param {string} aquariumName
   * @param {number} afterPercent @param {number} beforePercent
   */
  stockingImpact: (subjectWord, aquariumName, afterPercent, beforePercent) =>
    `Adding ${subjectWord} would bring ${aquariumName} to ~${afterPercent}% ` +
    `of its stocking guideline (from ~${beforePercent}%).`,
  stockingUnknown: "We can't estimate the bioload — adult size unknown for this species.",
  fallbackName: "your aquarium",
});
