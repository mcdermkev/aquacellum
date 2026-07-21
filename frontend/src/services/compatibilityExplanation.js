/**
 * compatibilityExplanation.js
 *
 * Plain-language compatibility explanations (Task 8, Tier B). Composes the
 * canonical tank-fit scorer — `evaluateTankFit` from `addOnRecommender.js` —
 * and turns its numeric score/verdict/reasons into buyer-facing copy:
 * `{ verdict, score, headline, reasons: string[] }`.
 *
 * This module does NOT re-derive compatibility. It never recomputes a score
 * or re-checks a threshold; it only reads `evaluateTankFit`'s output and
 * chooses a headline + humanizes the reasons already returned by it. See
 * docs/TASK_08_CATALOG_SPEC.md §2.
 */

import { evaluateTankFit } from "./addOnRecommender.js";

// ─── Headlines per verdict ───────────────────────────────────────────────────

const HEADLINES = Object.freeze({
  blocked: "Not a safe fit for your tank",
  caution: "Proceed with caution",
  ok: "Good fit for your tank",
});

const NO_TANK_HEADLINE = "Select a tank to check fit";
const NO_TANK_REASON = "Set up your display tank to see a personalized compatibility check for this species.";

/**
 * Build a plain-language compatibility explanation for a species/tank pair.
 *
 * @param {Object} speciesProfile - normalizeSpeciesProfile shape (or any
 *   object exposing minVolumeGallons/tempRange/phRange), passed straight
 *   through to evaluateTankFit.
 * @param {{volume:number, temp:number, ph:number}|null|undefined} displayTank
 * @returns {{ verdict:string, score:number, headline:string, reasons:string[] }}
 */
export function buildCompatibilityExplanation(speciesProfile, displayTank) {
  if (!displayTank) {
    return {
      verdict: "no_tank",
      score: 0,
      headline: NO_TANK_HEADLINE,
      reasons: [NO_TANK_REASON],
    };
  }

  const { verdict, score, reasons } = evaluateTankFit(speciesProfile, displayTank);

  return {
    verdict,
    score,
    headline: HEADLINES[verdict] || HEADLINES.caution,
    reasons: humanizeReasons(verdict, reasons, speciesProfile, displayTank),
  };
}

// ─── Reason humanization ─────────────────────────────────────────────────────
//
// evaluateTankFit's `reasons` are already human-readable strings, but they're
// terse and sometimes generic ("Tank fit is borderline..."). Here we add a
// concrete, friendlier lead-in for the common cases the spec calls out (e.g.
// "Your 10-gallon tank is below this species' 30-gallon minimum") while
// still surfacing every reason evaluateTankFit produced — nothing from the
// scorer's output is dropped or overridden.

function humanizeReasons(verdict, reasons, speciesProfile, displayTank) {
  if (verdict === "ok") {
    return buildGoodFitReasons(speciesProfile, displayTank);
  }

  const humanized = reasons.map((reason) => humanizeOne(reason));
  return humanized.length > 0 ? humanized : [HEADLINES[verdict] || "Review compatibility before adding."];
}

function humanizeOne(reason) {
  const volumeMatch = /Tank volume \((\d+(?:\.\d+)?)gal\) is less than half the species' minimum \((\d+(?:\.\d+)?)gal\)/.exec(reason);
  if (volumeMatch) {
    const [, tankVol, minVol] = volumeMatch;
    return `Your ${tankVol}-gallon tank is well below this species' ${minVol}-gallon minimum.`;
  }

  if (/tank volume.*unknown|minimum tank volume is unknown/i.test(reason)) {
    return "We don't have a confirmed minimum tank size for this species yet, so double-check care guides before adding.";
  }

  const tempMatch = /Tank temperature \((-?\d+(?:\.\d+)?)°C\) is more than (\d+(?:\.\d+)?)°C outside the species range/.exec(reason);
  if (tempMatch) {
    const [, tankTemp] = tempMatch;
    return `Your tank's ${tankTemp}°C temperature is well outside this species' comfortable range.`;
  }

  if (/temperature range is unknown/i.test(reason)) {
    return "We don't have a confirmed temperature range for this species yet.";
  }

  const phMatch = /Tank pH \((-?\d+(?:\.\d+)?)\) is more than (\d+(?:\.\d+)?) outside the species range/.exec(reason);
  if (phMatch) {
    const [, tankPh] = phMatch;
    return `Your tank's pH of ${tankPh} is well outside this species' comfortable range.`;
  }

  if (/pH range is unknown/i.test(reason)) {
    return "We don't have a confirmed pH range for this species yet.";
  }

  if (/No tank context provided/i.test(reason)) {
    return NO_TANK_REASON;
  }

  if (/borderline/i.test(reason)) {
    return "Some water parameters are a stretch for this species — double-check before adding it to your tank.";
  }

  return reason;
}

function buildGoodFitReasons(speciesProfile, displayTank) {
  const reasons = [];

  const volKnown = typeof speciesProfile?.minVolumeGallons === "number" && Number.isFinite(speciesProfile.minVolumeGallons);
  if (volKnown && Number(displayTank.volume) >= speciesProfile.minVolumeGallons) {
    reasons.push(`Your ${displayTank.volume}-gallon tank meets this species' ${speciesProfile.minVolumeGallons}-gallon minimum.`);
  }

  if (isRange(speciesProfile?.tempRange)) {
    reasons.push(`Temperature is a good match (species range ${speciesProfile.tempRange[0]}–${speciesProfile.tempRange[1]}°C).`);
  }

  if (isRange(speciesProfile?.phRange)) {
    reasons.push(`pH is a good match (species range ${speciesProfile.phRange[0]}–${speciesProfile.phRange[1]}).`);
  }

  if (reasons.length === 0) {
    reasons.push("Good fit for your tank.");
  }

  return reasons;
}

function isRange(r) {
  return Array.isArray(r) && r.length === 2 && Number.isFinite(Number(r[0])) && Number.isFinite(Number(r[1]));
}
