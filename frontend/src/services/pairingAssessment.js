/**
 * pairingAssessment.js — the one place a proposed breeding pair is evaluated.
 *
 * Implements docs/BREEDER_TOOLS_T1_PAIRING_SPEC.md §2.4.
 *
 * REPLACES `SpawningWizard.calculateInbreeding`, which compared only the two
 * candidates' IMMEDIATE parents. Its verdicts were:
 *
 *   shared sire AND dam  → 25%  "Critical Sibling Pair"
 *   shared sire OR  dam  → 12.5% "High Half-Sibling Pair"
 *   one is the other's parent → 25% "Critical Parent-Offspring Pair"
 *   anything else        → 0%   "Safe Lineage"          ← the bug
 *
 * So cousins, half-cousins, and grandparent–grandchild pairings all reported a
 * confident "0% Safe" — and that number was written onto every offspring's
 * certificate as the "Inbreeding Coefficient" attribute, where
 * SpecimenDetailModal reads it back. A cousin pairing permanently recorded a
 * false genetic claim on up to ten certificates.
 *
 * Now: ancestors resolve through services/pedigree.js (Dexie-first — see
 * BREEDER_STATE_MODEL §3 for why asking the contract with a local serial returns
 * the wrong fish) and relatedness is Wright's path method over three
 * generations via utils/coiCalculator.js. One engine, the real one.
 *
 * TWO RULES THAT ARE NOT NEGOTIABLE (spec §1.2, §1.7):
 *
 *   1. Only a KNOWN same-sex pair may block. Not unsexed, not a species
 *      mismatch, and NOT a high COI — line-breeding is deliberate practice and
 *      the coefficient is information, not a gate.
 *   2. Never fabricate a coefficient. 0% must mean "verified outbred across
 *      three generations". When it can't mean that, the result is an explicit
 *      unavailable state. See `isZeroReportable` below — this is the subtle part.
 */

import { fetchPedigreeTree, PEDIGREE_DEPTH } from "./pedigree";
import { buildAncestorMapFromTree, calculateCOIFromMaps } from "../utils/coiCalculator";
import { canPair, normalizeSex, PAIRING_COPY, PAIRING_SEVERITY } from "../utils/specimenSex";

/** Does this resolved tree have any recorded parent at all? */
function hasRecordedAncestry(tree) {
  if (!tree) return false;
  return !!(tree.parents?.sire || tree.parents?.dam);
}

/**
 * Whether a computed coefficient of ZERO is a reportable finding.
 *
 * This is the crux of spec §1.7 and the reason the old engine was misleading.
 *
 * - A NON-ZERO result is always reportable: shared ancestors were positively
 *   detected, which is direct evidence of relatedness no matter how sparse the
 *   rest of the pedigree is.
 * - A ZERO result only means "unrelated" if BOTH sides actually have recorded
 *   ancestry to search. If either side is a wild-caught or unmirrored fish with
 *   no known parents, then "no shared ancestors found" is simply "we looked at
 *   nothing" — reporting 0% there is the exact overconfidence being fixed.
 *
 * Note this deliberately keeps the parent–offspring case reportable: if the sire
 * IS the dam's father, the dam has recorded ancestry naming him, so a shared
 * ancestor is found and the 25% is positive evidence even when the sire himself
 * is wild-caught.
 */
function isZeroReportable(sireTree, damTree) {
  return hasRecordedAncestry(sireTree) && hasRecordedAncestry(damTree);
}

/**
 * Evaluate a proposed pairing.
 *
 * @param {object} params
 * @param {object|null} params.contract - AquadexManager contract, or null for local-only
 * @param {object} params.sire - { id, speciesId, gender }
 * @param {object} params.dam  - { id, speciesId, gender }
 * @param {boolean} [params.casual] - casual-mode copy
 * @returns {Promise<{
 *   sex: { ok: boolean, severity: string, reason: string },
 *   species: { ok: boolean, reason: string }|null,
 *   coi: { available: boolean, coi?: number, riskLevel?: string,
 *          recommendation?: string, sharedAncestors?: Array, paths?: Array,
 *          depth: number, unavailableReason?: string }|null,
 *   canProceed: boolean
 * }>}
 */
export async function assessPairing({ contract = null, sire, dam, casual = false } = {}) {
  const pick = (key) => (casual ? PAIRING_COPY[key].casual : PAIRING_COPY[key].pro);

  if (!sire || !dam) {
    return { sex: null, species: null, coi: null, canProceed: false };
  }

  // ── Sex ──────────────────────────────────────────────────────────────────
  const sex = canPair(sire.gender, dam.gender, { casual });

  // ── Species (independent of relatedness) ─────────────────────────────────
  // The old engine conflated these, returning "Hybrid / Species Mismatch" AS an
  // inbreeding result with coefficient 0. A mismatch is a compatibility signal;
  // relatedness is a separate number. Report both, don't merge them.
  const sameSpecies = Number(sire.speciesId) === Number(dam.speciesId);
  const species = sameSpecies
    ? { ok: true, reason: "" }
    : { ok: false, reason: pick("speciesMismatch") };

  // ── Relatedness ──────────────────────────────────────────────────────────
  const coi = await computeRelatedness({ contract, sire, dam, pick });

  return {
    sex,
    species,
    coi,
    // The ONLY blocking condition. A species mismatch is surfaced but the wizard
    // keeps its own separate species guard on the Next button; a high COI never
    // blocks (spec §1.3).
    canProceed: sex.ok,
  };
}

/**
 * Walk both pedigrees and score relatedness, or report honestly that it can't
 * be scored. Never throws — a resolution failure is an unavailable result, not
 * an error the wizard has to handle.
 */
async function computeRelatedness({ contract, sire, dam, pick }) {
  const unavailable = () => ({
    available: false,
    depth: PEDIGREE_DEPTH,
    unavailableReason: pick("coiUnavailableDetail"),
  });

  try {
    const [sireTree, damTree] = await Promise.all([
      fetchPedigreeTree(contract, sire.id),
      fetchPedigreeTree(contract, dam.id),
    ]);
    if (!sireTree || !damTree) return unavailable();

    const result = calculateCOIFromMaps(
      buildAncestorMapFromTree(sireTree, "sire"),
      buildAncestorMapFromTree(damTree, "dam")
    );

    const foundRelatedness = result.sharedAncestors.length > 0;
    if (!foundRelatedness && !isZeroReportable(sireTree, damTree)) {
      return unavailable();
    }

    return {
      available: true,
      coi: result.coi,
      riskLevel: result.riskLevel,
      // A verified zero gets the plain-language confirmation rather than the
      // generic engine text, so "outbred" reads as a finding, not a default.
      recommendation: foundRelatedness ? result.recommendation : pick("coiOutbred"),
      sharedAncestors: result.sharedAncestors,
      paths: result.paths,
      depth: PEDIGREE_DEPTH,
    };
  } catch (err) {
    console.warn("[PairingAssessment] Relatedness check failed:", err);
    return unavailable();
  }
}

/**
 * The attributes recorded onto each offspring certificate for a pairing.
 *
 * Self-describing on purpose (spec §1.6): the previous value was a bare
 * percentage from a parent-only heuristic, so a reader had no way to tell a real
 * Wright coefficient from the old "0%". Method and depth now travel with the
 * number, and an unavailable result records an explicit unknown rather than a
 * zero that would read as "verified outbred".
 *
 * @param {object} assessment - the result of {@link assessPairing}
 * @param {object} sire - { gender }
 * @param {object} dam  - { gender }
 * @returns {Array<{trait_type: string, value: string}>}
 */
export function pairingMetadataAttributes(assessment, sire, dam) {
  const coi = assessment?.coi;
  const attrs = [];

  if (coi?.available) {
    attrs.push({ trait_type: "Inbreeding Coefficient", value: `${coi.coi}%` });
    attrs.push({ trait_type: "COI Method", value: `Wright, ${coi.depth} generations` });
  } else {
    attrs.push({ trait_type: "Inbreeding Coefficient", value: "Unknown — no pedigree data" });
    attrs.push({ trait_type: "COI Method", value: "Not calculated" });
  }

  // Sexes are known data now, and recording them is what makes the pairing
  // auditable after the fact.
  attrs.push({ trait_type: "Sire Sex", value: normalizedSexValue(sire) });
  attrs.push({ trait_type: "Dam Sex", value: normalizedSexValue(dam) });

  return attrs;
}

function normalizedSexValue(specimen) {
  return normalizeSex(specimen?.gender);
}

export { PAIRING_SEVERITY };
