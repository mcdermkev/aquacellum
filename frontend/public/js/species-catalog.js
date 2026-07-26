/**
 * species-catalog.js — browser mirror of the canonical difficulty contract.
 *
 * The Vite app imports the real module at src/services/speciesCatalog.js. The
 * static marketing pages (database.html, compare.html, ...) are plain <script>
 * pages that can't import ESM from src/, so they load this small mirror as a
 * global (`window.SpeciesCatalog`).
 *
 * This mirrors ONLY the difficulty helpers the static pages need. It is kept in
 * lockstep with the canonical module by a parity test
 * (src/services/speciesCatalog.test.js) that require()s this file and asserts
 * the two agree — so the app and the marketing site can never drift on "how
 * hard is this fish?".
 *
 * Do not add app-only logic (catalog projection, profiles) here; those belong
 * in the ESM module.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // Node / vitest parity test
  }
  root.SpeciesCatalog = api; // browser global
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var DIFFICULTY = {
    beginner: { key: "beginner", label: "Beginner", order: 1, careLevel: 0, badgeClass: "badge-beginner", tierClass: "tier-beginner" },
    intermediate: { key: "intermediate", label: "Intermediate", order: 2, careLevel: 1, badgeClass: "badge-intermediate", tierClass: "tier-intermediate" },
    advanced: { key: "advanced", label: "Advanced", order: 3, careLevel: 2, badgeClass: "badge-advanced", tierClass: "tier-advanced" },
    difficult: { key: "difficult", label: "Difficult", order: 4, careLevel: 2, badgeClass: "badge-difficult", tierClass: "tier-difficult" },
  };

  var DIFFICULTY_UNKNOWN = { key: "unknown", label: "Unknown", order: 0, careLevel: 1, badgeClass: "badge-unknown", tierClass: "tier-beginner" };

  var DIFFICULTY_ALIASES = {
    easy: "beginner", beginner: "beginner",
    intermediate: "intermediate", medium: "intermediate",
    advanced: "advanced", hard: "advanced",
    difficult: "difficult", expert: "difficult",
  };

  var LEGACY_CARE_LEVEL = {
    easy: 0, beginner: 0, intermediate: 1, medium: 1, difficult: 2, advanced: 2, expert: 3,
  };

  function normalizeDifficulty(raw) {
    var k = String(raw == null ? "" : raw).toLowerCase().trim();
    var key = DIFFICULTY_ALIASES[k];
    return key ? DIFFICULTY[key] : DIFFICULTY_UNKNOWN;
  }

  function difficultyToCareLevel(raw) {
    var k = String(raw == null ? "" : raw).toLowerCase().trim();
    var v = LEGACY_CARE_LEVEL[k];
    return v == null ? 1 : v;
  }

  return {
    DIFFICULTY: DIFFICULTY,
    DIFFICULTY_UNKNOWN: DIFFICULTY_UNKNOWN,
    normalizeDifficulty: normalizeDifficulty,
    difficultyToCareLevel: difficultyToCareLevel,
  };
});
