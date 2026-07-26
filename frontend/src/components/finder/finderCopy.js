/**
 * finderCopy.js — the single source of Casual Fish Finder language
 * (Fish Finder Rework, Task 10).
 *
 * T5–T9 built the finder surfaces with their copy inlined in JSX, which let
 * two kinds of drift in:
 *
 *   1. VOCABULARY DRIFT. The finder used both nouns for the same thing, often
 *      in adjacent lines of the same block ("Add an aquarium to get matches…"
 *      directly above "Add a tank →"), and the species detail asked "Does it
 *      fit your tank?" above "Add an aquarium to check…". See CONTAINER_NOUN
 *      below for which one won and why.
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
// CONTAINER_NOUN: "tank", not "aquarium".
//
// "Tank" is what aquarium keepers actually say, and it's already the word in
// the two places a keeper reads most: the fit engine's generated verdicts
// ("Good fit for your tank", "Your 20-gallon tank meets this species'
// 10-gallon minimum" — services/speciesFit.js, shared with the Pro surfaces)
// and the internal data model (displayTank, tankFitInputs). Standardizing on
// "tank" therefore aligns the finder's chrome copy with the most prominent
// copy on every card, without touching the shared fit engine or Pro wording.
//
// Known remaining mismatch: App.jsx still labels the Casual nav tab
// "My Aquariums". That's a global shell/product naming call, not a finder one,
// so it's deliberately left alone here — see the T11/T12 handoff note.
export const CONTAINER_NOUN = "tank";
export const CONTAINER_NOUN_PLURAL = "tanks";

// Terms that must never appear in Casual finder copy. "aquarium" is here to
// keep one container noun (see above); the Web3 terms are covered separately
// and canonically by orderCopy.PROHIBITED_TERMS, which the test also applies.
export const OFF_VOCABULARY_TERMS = Object.freeze(["aquarium", "specimen", "taxonomy", "breeder-grade"]);

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
    pickerAria: "Choose a tank to match against",
    loadingAria: "Loading your tanks",
    emptyText: "Add a tank to get fish picked for your water.",
    emptyCta: "Add a tank →",
    unnamed: "Unnamed tank",
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
    /** @param {string} tankName */
    title: (tankName) => `Good matches for ${tankName}`,
    titleFallback: "Good matches for your tank",
    fallbackName: "your tank",
    loadingAria: "Finding matches",
    // No tanks at all yet.
    needTank: "Add a tank above to see fish picked for your water.",
    // Tanks exist but none is selected (guard — the bar auto-selects).
    chooseTank: "Choose a tank above to see matches picked for your water.",
    // Honest dead end: state both plausible causes without asserting either,
    // then hand the keeper somewhere to go.
    empty:
      "No matches to show for this tank yet — the species we checked either " +
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
  fitTitle: "Does it fit your tank?",
  careTitle: "Care needs",
  stockingTitle: "Stocking impact",

  contextBar: Object.freeze({
    pickerLabel: "Matching against",
    pickerAria: "Choose a tank to match against",
    unnamed: "Unnamed tank",
  }),

  /** @param {string} subjectWord — e.g. "this fish" / the species' name */
  emptyFit: (subjectWord) => `Add a tank to check whether ${subjectWord} fits your water.`,
  emptyFitCta: "Add a tank →",

  /**
   * Full stocking sentence, so the whole claim lives in one place rather than
   * being split across JSX lines.
   * @param {string} subjectWord @param {string} tankName
   * @param {number} afterPercent @param {number} beforePercent
   */
  stockingImpact: (subjectWord, tankName, afterPercent, beforePercent) =>
    `Adding ${subjectWord} would bring ${tankName} to ~${afterPercent}% ` +
    `of its stocking guideline (from ~${beforePercent}%).`,
  stockingUnknown: "We can't estimate the bioload — adult size unknown for this species.",
  fallbackName: "your tank",
});
