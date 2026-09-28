/**
 * speciesCatalog.js — the single source of truth for interpreting the curated
 * species catalog (`frontend/public/fishbase_master.json`).
 *
 * Fish Finder Rework, Task 1 (Tier A). One physical catalog file already backs
 * every reader (the in-app `useSpeciesData()` hook, the public `database.html`
 * page, and the Poseidon RAG server), but each reader *interpreted* it with its
 * own difficulty map and its own projection into a card/catalog shape. That
 * duplication is a drift hazard: "how hard is this fish?" and "what is its safe
 * range?" could silently diverge between the app and the marketing site.
 *
 * This module centralizes that interpretation so there is exactly one answer.
 * It is deliberately **behavior-preserving for the data that ships**: for the
 * canonical difficulty values the curated catalog actually uses (Beginner /
 * Intermediate / Advanced / Difficult, plus missing/unknown), the outputs
 * consumed today by `BreedGallery.globalRefList` and by `database.html`'s
 * difficulty helpers are reproduced exactly (see speciesCatalog.test.js, which
 * pins both). It only *adds* non-breaking fields (`difficulty`, `profile`).
 *
 * `normalizeDifficulty` intentionally does slightly MORE than the old helpers:
 * it lower-cases, trims, and resolves aliases (easy→beginner, medium→
 * intermediate, hard→advanced, expert→difficult). The legacy `database.html`
 * helpers did none of that, so for a non-canonical/whitespace-padded raw value
 * the new module is a deliberate superset, not a byte match. This never diverges
 * for shipped data (only the four canonical words appear) but is the one place
 * the "reproduced exactly" claim is scoped to canonical inputs.
 *
 * Two intentional, documented quirks are preserved rather than "fixed" here,
 * because changing them is a visible product decision for a later task (T6/T2),
 * not a silent refactor:
 *
 *   1. Missing-difficulty policy differs by surface. The in-app catalog treats
 *      a missing `difficulty` as "easy" (careLevel 0 — see the legacy
 *      `(item.tankMetrics?.difficulty || "easy")` default), while the public
 *      page treats a missing difficulty as "Unknown". `toCatalogEntry` keeps
 *      the app's "easy" default; `normalizeDifficulty` (used by the web mirror)
 *      keeps the "Unknown" behavior.
 *   2. Display ranges are honest. `toCatalogEntry` used to emit fabricated
 *      22–28°C / pH 6.5–7.5 fallbacks when a species had no range (card parity
 *      with the old globalRefList). Spec-Dex now hides a param when it is null
 *      rather than printing an em dash or a made-up band, so missing ranges
 *      stay null on both `minTemp`/`maxTemp`/`minPh`/`maxPh` and `entry.profile`.
 *
 * Pure and dependency-light (only composes the Tier-A `normalizeSpeciesProfile`).
 */

import { normalizeSpeciesProfile } from "./shippingSafety.js";

// ─── Canonical difficulty model ──────────────────────────────────────────────
//
// The curated catalog stores a 4-tier `tankMetrics.difficulty` string:
// Beginner < Intermediate < Advanced < Difficult. That is the canonical scale.
//
// Each descriptor carries every projection the surfaces need, so no consumer
// re-derives them:
//   - `order`      1..4 sort weight / full-fidelity rank (0 = unknown).
//                  Matches database.html `getDifficultyWeight`.
//   - `careLevel`  the app's coarse 0..3 index (see CARE_LABELS). Advanced and
//                  Difficult BOTH map to 2, matching the pre-refactor app
//                  (`DIFFICULTY_MAP`). Kept coarse for byte-parity; use `key`/
//                  `order` when you need to tell Advanced from Difficult.
//   - `badgeClass` / `tierClass`  the public page's card CSS classes.
//                  Match database.html `getDifficultyClass` / `getTierClass`.

export const DIFFICULTY = Object.freeze({
  beginner: Object.freeze({
    key: "beginner", label: "Beginner", order: 1, careLevel: 0,
    badgeClass: "badge-beginner", tierClass: "tier-beginner",
  }),
  intermediate: Object.freeze({
    key: "intermediate", label: "Intermediate", order: 2, careLevel: 1,
    badgeClass: "badge-intermediate", tierClass: "tier-intermediate",
  }),
  advanced: Object.freeze({
    key: "advanced", label: "Advanced", order: 3, careLevel: 2,
    badgeClass: "badge-advanced", tierClass: "tier-advanced",
  }),
  difficult: Object.freeze({
    key: "difficult", label: "Difficult", order: 4, careLevel: 2,
    badgeClass: "badge-difficult", tierClass: "tier-difficult",
  }),
});

// Returned for a missing/unrecognized difficulty. Mirrors the public page's
// fallbacks exactly: badge-unknown, tier-beginner, weight 0. `careLevel` is 1
// to match the app's `?? 1` lookup default.
export const DIFFICULTY_UNKNOWN = Object.freeze({
  key: "unknown", label: "Unknown", order: 0, careLevel: 1,
  badgeClass: "badge-unknown", tierClass: "tier-beginner",
});

// Raw catalog string (case-insensitive) → canonical difficulty key. The
// easy/medium/hard aliases are defensive: the curated data only ever uses the
// four canonical words, but on-chain / partner records occasionally differ.
const DIFFICULTY_ALIASES = Object.freeze({
  easy: "beginner",
  beginner: "beginner",
  intermediate: "intermediate",
  medium: "intermediate",
  advanced: "advanced",
  hard: "advanced",
  difficult: "difficult",
  expert: "difficult",
});

/**
 * Resolve a raw difficulty value into its canonical descriptor.
 * Missing/unrecognized → DIFFICULTY_UNKNOWN (the public page's behavior).
 * @param {string|null|undefined} raw
 * @returns {typeof DIFFICULTY.beginner | typeof DIFFICULTY_UNKNOWN}
 */
export function normalizeDifficulty(raw) {
  const key = DIFFICULTY_ALIASES[String(raw ?? "").toLowerCase().trim()];
  return key ? DIFFICULTY[key] : DIFFICULTY_UNKNOWN;
}

// The app's legacy coarse careLevel lookup, reproduced verbatim (including the
// `?? 1` miss default and the distinct expert→3). `toCatalogEntry` feeds this
// `(difficulty || "easy")`, exactly as `globalRefList` did.
const LEGACY_CARE_LEVEL = Object.freeze({
  easy: 0, beginner: 0,
  intermediate: 1, medium: 1,
  difficult: 2, advanced: 2,
  expert: 3,
});

/**
 * Legacy 0..3 careLevel index for a raw difficulty string. Faithful to the
 * pre-refactor `DIFFICULTY_MAP[diffStr] ?? 1` lookup (NOTE: no "easy" default is
 * applied here — the caller supplies it, matching `globalRefList`).
 * @param {string|null|undefined} raw
 * @returns {number} 0..3
 */
export function difficultyToCareLevel(raw) {
  const k = String(raw ?? "").toLowerCase().trim();
  return LEGACY_CARE_LEVEL[k] ?? 1;
}

// ─── App display-label constants (single source) ─────────────────────────────
// Canonical home for the arrays `SpeciesCardPremium` (and BreedGallery's
// `CARE_LEVEL_STRINGS`) previously copied locally. Indexed by `careLevel`.
export const CARE_LABELS = Object.freeze(["Easy", "Medium", "Difficult", "Expert"]);
export const CARE_BADGE_CLASS = Object.freeze(["easy", "medium", "hard", "expert"]);

// ─── Global catalog projection ───────────────────────────────────────────────

// Missing ranges stay null. Callers (Spec-Dex cards, flip-back params) hide
// the chip rather than printing an em dash or a fabricated 22–28°C / 6.5–7.5.

/**
 * Project one curated catalog record (fishbase_master.json shape) into the
 * in-app "global reference" catalog entry. Reproduces the exact shape/values
 * `BreedGallery.globalRefList` built, and adds two non-breaking fields:
 *   - `difficulty`: the canonical descriptor (from the raw value, "easy"-
 *     defaulted for app consistency with `careLevel`).
 *   - `profile`: normalizeSpeciesProfile output — honest ranges (null when
 *     unknown), size, temperament — for the compatibility engine.
 *
 * @param {Object} record
 * @returns {Object} catalog entry
 */
export function toCatalogEntry(record = {}) {
  const tm = record.tankMetrics || {};
  const specCode = record.specCode ?? record.speciesId;
  // App parity: a missing difficulty historically counted as "easy".
  const rawDifficulty = tm.difficulty || "easy";

  return {
    speciesId: specCode,
    allSpeciesIds: [specCode],
    scientificName: record.scientificName,
    commonName: record.commonName,
    canonicalIpfsUri: "ipfs://placeholder",
    careLevel: difficultyToCareLevel(rawDifficulty),
    minTemp: tm.tempRangeCelsius?.[0] ?? null,
    maxTemp: tm.tempRangeCelsius?.[1] ?? null,
    minPh: tm.phRange?.[0] ?? null,
    maxPh: tm.phRange?.[1] ?? null,
    specimenCount: 0,
    isGlobal: true,
    // ── New, non-breaking ──────────────────────────────────────────────────
    difficulty: normalizeDifficulty(rawDifficulty),
    profile: normalizeSpeciesProfile(record),
  };
}

/**
 * Build the de-duplicated in-app global catalog from curated records. Matches
 * `globalRefList`'s dedup: first occurrence wins, keyed on lowercased
 * scientificName and on specCode. Records without a scientificName are skipped.
 * @param {Array} records
 * @returns {Array} catalog entries
 */
export function buildGlobalCatalog(records = []) {
  if (!Array.isArray(records) || records.length === 0) return [];

  const seenNames = new Set();
  const seenCodes = new Set();
  const catalog = [];

  for (const item of records) {
    if (!item || !item.scientificName) continue;
    const nameLower = item.scientificName.toLowerCase();
    if (seenNames.has(nameLower) || seenCodes.has(item.specCode)) continue;
    seenNames.add(nameLower);
    seenCodes.add(item.specCode);
    catalog.push(toCatalogEntry(item));
  }

  return catalog;
}
