/**
 * identifyGrounding.js — reconcile a model's species guess with the real catalog.
 *
 * Lives here rather than inside `api/ai.js` for two reasons. It is catalog logic,
 * not request handling; and `ai.js` imports `ethers`, which the Vite config aliases
 * to a browser shim that touches `window`, so anything importable from a node test
 * has to stay out of that file.
 *
 * ── Why this exists at all ───────────────────────────────────────────────────
 * A photo identification is a SUGGESTION. Sexual dimorphism, juvenile colouration,
 * line-bred morphs and hybrids all defeat it, and the model will happily return a
 * well-formed name for a fish it cannot actually place.
 *
 * `inCatalog` is the load-bearing field. A name the model produced is a guess; a
 * `specCode` is a row in our curated data. Keeping those distinguishable is what
 * stops an AI guess being rendered as a database record — which matters because the
 * stated goal for this database is to be the accurate one, and because a user may
 * log an identification against a specimen and carry the error into a pedigree.
 */

import { findSpeciesInQuery } from './speciesIndex.js';

/** Most the UI will show, and most the model is asked for. */
const MAX_CANDIDATES = 3;

/**
 * @param {unknown} raw The model's `candidates` array, trusted for nothing.
 * @returns {Array<{scientificName: string, commonName: string, confidence: number,
 *                  specCode: (number|string|null), inCatalog: boolean,
 *                  catalogCommonName: (string|null)}>}
 */
export function groundCandidates(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .slice(0, MAX_CANDIDATES)
    .map((c) => {
      const scientificName = String(c?.scientificName || '').trim();
      const commonName = String(c?.commonName || '').trim();

      // Clamp rather than trust. A model returning 1.7, -3 or "high" must not be
      // able to render a confidence bar wrong, and NaN must never reach the client.
      const rawConfidence = Number(c?.confidence);
      const confidence = Number.isFinite(rawConfidence)
        ? Math.min(1, Math.max(0, rawConfidence))
        : 0;

      const match = scientificName ? findSpeciesInQuery(scientificName, 1)[0] || null : null;

      return {
        scientificName,
        commonName,
        confidence,
        specCode: match?.specCode ?? null,
        inCatalog: Boolean(match),
        // Prefer our curated name when we hold the species, so one fish is called
        // one thing everywhere in the app.
        catalogCommonName: match?.commonName ?? null,
      };
    })
    .filter((c) => c.scientificName || c.commonName);
}
