/**
 * matchRanking.js — the deterministic core of the Casual Fish Finder "Good
 * matches for [your tank]" home (Fish Finder Rework, Task 5 / Tier B).
 *
 * This module composes the canonical fit engine (`assessSpeciesFit`,
 * speciesFit.js) — it never re-derives a score or a verdict. Its only job is
 * to turn a catalog + a tank context into a best-first, stably-ordered list
 * of candidates for the home section.
 *
 * Pure and dependency-light: no React, no I/O. Same inputs → same output.
 */

import { assessSpeciesFit } from "../../services/speciesFit.js";

// Verdict → sort rank. Lower ranks (better fits) sort first. `no_tank` should
// never actually appear here in practice (see below), but it's included so
// the ordering is total and defined for every verdict the engine can return.
const VERDICT_RANK = Object.freeze({
  ok: 0,
  caution: 1,
  blocked: 2,
  no_tank: 3,
});

/**
 * Rank catalog entries by how well they fit a tank, best-first.
 *
 * @param {Array<Object>} entries - catalog entries (global or contract shape)
 * @param {{volume:number, temp:number, ph:number}|null|undefined} tankContext
 * @param {Object} [opts]
 * @param {Array}   [opts.fishbaseData] - curated master records, passed through to assessSpeciesFit
 * @param {number}  [opts.limit=12] - max results to return
 * @param {Array}   [opts.excludeSpeciesIds=[]] - speciesIds to omit (e.g. species already in the tank)
 * @returns {Array<{entry:Object, fit:Object}>} best-first, capped at `limit`
 */
export function rankSpeciesMatches(entries, tankContext, opts = {}) {
  const { fishbaseData = [], limit = 12, excludeSpeciesIds = [] } = opts;

  // No tank selected → no fake ranking. The home shows the "pick a tank" state.
  if (!tankContext) return [];
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const excluded = new Set((excludeSpeciesIds || []).map((id) => Number(id)));

  const candidates = entries
    .filter((entry) => entry && !excluded.has(Number(entry.speciesId)))
    .map((entry) => ({
      entry,
      fit: assessSpeciesFit(entry, tankContext, { fishbaseData }),
    }));

  candidates.sort((a, b) => {
    const rankDiff = (VERDICT_RANK[a.fit.verdict] ?? 1) - (VERDICT_RANK[b.fit.verdict] ?? 1);
    if (rankDiff !== 0) return rankDiff;

    if (b.fit.score !== a.fit.score) return b.fit.score - a.fit.score;

    const nameA = a.entry.commonName || "";
    const nameB = b.entry.commonName || "";
    return nameA.localeCompare(nameB);
  });

  return candidates.slice(0, limit);
}
