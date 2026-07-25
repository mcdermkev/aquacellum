/**
 * compatibleTanks.js — "which of my tanks suit this species?" (Logbook Rework
 * Task 10, Knowledge layer / Task 7 compatibility suggestions).
 *
 * Composes the canonical, Opus-reviewed tank-fit engine — it does NOT
 * re-derive compatibility:
 *   - `normalizeSpeciesProfile` (shippingSafety.js) turns a catalog record into
 *     the { minVolumeGallons, tempRange, phRange } shape the scorer expects.
 *   - `evaluateTankFit` (addOnRecommender.js) is the single scorer/verdict.
 *
 * Used to rank a keeper's own tanks when deciding where to move an unassigned
 * species group. Pure and dependency-light. Because it leans on
 * `evaluateTankFit`, it inherits that engine's safety rule: it never blocks on
 * missing data (an unknown species range yields "caution", never "blocked"),
 * so it can't fabricate a false "unsafe" verdict.
 */

import { evaluateTankFit } from "./addOnRecommender.js";
import { normalizeSpeciesProfile } from "./shippingSafety.js";

const LITERS_TO_GALLONS = 0.264172;

function isRange(r) {
  return Array.isArray(r) && r.length === 2 && Number.isFinite(Number(r[0])) && Number.isFinite(Number(r[1]));
}

/**
 * Convert a logbook tank into the { volume, temp, ph } shape evaluateTankFit
 * consumes. Volume is always known (from the tank record); temp/pH come from
 * the latest on-chain-style log when present, otherwise left undefined (the
 * scorer treats unknown water params as non-blocking).
 * @param {object} tank
 * @returns {{volume:number, temp:(number|undefined), ph:(number|undefined)}}
 */
export function tankFitInputs(tank) {
  const gallons = Number(tank?.volumeLiters) * LITERS_TO_GALLONS;
  const log = tank?.latestLog || {};
  const temp = log.tempCelsiusX10 != null ? Number(log.tempCelsiusX10) / 10
    : log.temp != null ? Number(log.temp) : undefined;
  const ph = log.phX10 != null ? Number(log.phX10) / 10
    : log.ph != null ? Number(log.ph) : undefined;
  return { volume: Number.isFinite(gallons) ? Math.round(gallons) : 0, temp, ph };
}

/**
 * Derive a normalized species profile for a specimen/species reference, using
 * the same catalog sources the rest of the logbook uses (contract catalog
 * preferred for temp/pH/care, curated fishbase for tank metrics/size).
 * @param {{speciesId?:number, commonName?:string, scientificName?:string}} ref
 * @param {Array} [fishbaseData]
 * @param {Array} [contractSpecies]
 * @returns {object|null} normalizeSpeciesProfile output
 */
export function deriveSpeciesProfile(ref, fishbaseData = [], contractSpecies = []) {
  if (!ref) return null;
  const idMatch = (x) => Number(x?.speciesId ?? x?.specCode) === Number(ref.speciesId);
  const nameMatch = (x) => x?.commonName && ref.commonName && x.commonName === ref.commonName;
  const contract = contractSpecies.find((c) => idMatch(c) || nameMatch(c));
  const fb = fishbaseData.find((f) => idMatch(f) || nameMatch(f));
  // Merge so the normalizer sees both fishbase tankMetrics and the contract's
  // min/max temp/pH fields; contract wins on key collisions.
  const merged = { commonName: ref.commonName, speciesId: ref.speciesId, ...(fb || {}), ...(contract || {}) };
  return normalizeSpeciesProfile(merged);
}

/**
 * Does a profile carry any real care data? When nothing is known, a fit ranking
 * is essentially volume-only against a default minimum — useful to order by, but
 * not confident enough to badge as a species-specific recommendation.
 * @param {object|null} profile
 */
export function profileHasCareData(profile) {
  return !!profile && (
    (profile.minVolumeGallons != null && Number.isFinite(Number(profile.minVolumeGallons))) ||
    isRange(profile.tempRange) ||
    isRange(profile.phRange)
  );
}

const VERDICT_RANK = { ok: 0, caution: 1, blocked: 2 };

/**
 * Rank a keeper's tanks by how well they fit a species, best-first.
 * @param {object} profile   normalizeSpeciesProfile output
 * @param {Array} tanks
 * @returns {Array<{tank:object, verdict:string, score:number, inputs:object}>}
 */
export function rankCompatibleTanks(profile, tanks = []) {
  return (Array.isArray(tanks) ? tanks : [])
    .map((tank) => {
      const inputs = tankFitInputs(tank);
      const { verdict, score } = evaluateTankFit(profile || {}, inputs);
      return { tank, verdict, score, inputs };
    })
    .sort((a, b) => {
      const vr = (VERDICT_RANK[a.verdict] ?? 1) - (VERDICT_RANK[b.verdict] ?? 1);
      if (vr !== 0) return vr;
      if (b.score !== a.score) return b.score - a.score;
      return Number(a.tank?.id) - Number(b.tank?.id);
    });
}
