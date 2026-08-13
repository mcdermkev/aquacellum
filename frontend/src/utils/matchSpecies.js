/**
 * matchSpecies.js — resolve a typed species name to a CONTRACT-catalog species.
 * See docs/LIVESTOCK_IMPORT_SPEC.md §4.
 *
 * This is the correctness core of the livestock importer. `speciesId` here is
 * the numeric contract-catalog id (from useContractSpecies) that flows onto
 * every specimen record and its certificate — matching the wrong one silently
 * mislabels a fish's identity. So the contract is deliberately conservative:
 *
 *   - "exact"     → a case-insensitive full match on commonName or scientificName.
 *                   Safe to auto-resolve.
 *   - "suggested" → Fuse.js found near matches, but we return speciesId: null so
 *                   the UI forces a human pick. NEVER auto-import a fuzzy guess.
 *   - "none"      → no candidates; the user must pick manually or the row is
 *                   skipped.
 *
 * Pure + DOM-free (Fuse imports cleanly under the node test env).
 */

import Fuse from "fuse.js";

const FUSE_OPTIONS = {
  includeScore: true,
  threshold: 0.4,
  ignoreLocation: true,
  keys: [
    { name: "commonName", weight: 0.6 },
    { name: "scientificName", weight: 0.4 },
  ],
};

const MAX_CANDIDATES = 8;

function norm(s) {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * Build a reusable matcher over a contract-species catalog.
 * @param {Array<{ speciesId:number, commonName:string, scientificName:string }>} catalog
 * @returns {{ match: (name: string) => MatchResult, catalog: Array }}
 *
 * @typedef {Object} MatchResult
 * @property {"exact"|"suggested"|"none"} status
 * @property {number|null} speciesId  set only when status === "exact"
 * @property {object|null} entry      the matched catalog entry (exact only)
 * @property {Array} candidates       ranked suggestions for a picker
 */
export function buildSpeciesMatcher(catalog = []) {
  const list = Array.isArray(catalog) ? catalog : [];

  // Exact-match index by normalized common + scientific name. First entry wins
  // for a given name so results are deterministic.
  const exactIndex = new Map();
  for (const entry of list) {
    for (const key of [norm(entry.commonName), norm(entry.scientificName)]) {
      if (key && !exactIndex.has(key)) exactIndex.set(key, entry);
    }
  }

  const fuse = new Fuse(list, FUSE_OPTIONS);

  function match(name) {
    const n = norm(name);
    if (!n) return { status: "none", speciesId: null, entry: null, candidates: [] };

    const exact = exactIndex.get(n);
    if (exact) {
      return { status: "exact", speciesId: exact.speciesId, entry: exact, candidates: [exact] };
    }

    const results = fuse.search(n).slice(0, MAX_CANDIDATES).map((r) => r.item);
    if (results.length > 0) {
      return { status: "suggested", speciesId: null, entry: null, candidates: results };
    }

    return { status: "none", speciesId: null, entry: null, candidates: [] };
  }

  return { match, catalog: list };
}

/**
 * Convenience: resolve every DISTINCT name in a list to a match result.
 * @returns {Map<string, MatchResult>} keyed by the original (trimmed) name
 */
export function matchDistinctSpecies(names, catalog) {
  const matcher = buildSpeciesMatcher(catalog);
  const out = new Map();
  for (const raw of names) {
    const key = String(raw ?? "").trim();
    if (!key || out.has(key)) continue;
    out.set(key, matcher.match(key));
  }
  return out;
}
