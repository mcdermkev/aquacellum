/**
 * stockingGuidance.js — deterministic stocking / bioload guidance for a tank
 * (Logbook Rework Task 10, Knowledge layer).
 *
 * Estimates how heavily a tank is stocked from its combined inhabitants vs its
 * volume. Grounding rules (no fabrication):
 *   - Adult sizes come from the curated catalog via `deriveSpeciesProfile`
 *     (`normalizeSpeciesProfile`) — never invented. Species with no known adult
 *     size are EXCLUDED from the estimate and disclosed, never guessed.
 *   - Volume comes from the tank record.
 *   - The estimate uses the widely-cited "1 inch of adult fish per US gallon"
 *     rule of thumb, which is deliberately surfaced as a rough starting point
 *     (it ignores body mass, bioload, filtration and territory) rather than a
 *     precise verdict.
 *
 * Pure and dependency-light: safe to call in render.
 */

import { groupNurseryFish } from "./nurseryGrouping";
import { deriveSpeciesProfile } from "../services/compatibleTanks";

const LITERS_TO_GALLONS = 0.264172;
const CM_PER_INCH = 2.54; // "1 inch of adult fish per gallon" → 2.54 cm per gallon

/** Coarse stocking band from a length ratio (stocked-length / guideline capacity). */
function bandFor(ratio) {
  if (ratio <= 0.7) return "comfortable";
  if (ratio <= 1.0) return "stocked";
  if (ratio <= 1.3) return "full";
  return "over";
}

/**
 * Assess a tank's stocking level from its inhabitants and volume.
 *
 * @param {object} tank                 tank with `volumeLiters` and `specimens`
 * @param {object} [opts]
 * @param {Array}  [opts.fishbaseData]
 * @param {Array}  [opts.contractSpecies]
 * @returns {{
 *   applicable:boolean,
 *   volumeGallons:number,
 *   fishCount:number,
 *   knownCount:number,
 *   unknownCount:number,
 *   totalAdultLengthCm:number,
 *   capacityLengthCm:number,
 *   ratio:(number|null),
 *   band:(('comfortable'|'stocked'|'full'|'over')|null),
 *   assumptions:string[]
 * }}
 */
export function assessStocking(tank, opts = {}) {
  const { fishbaseData = [], contractSpecies = [] } = opts;
  const living = (Array.isArray(tank?.specimens) ? tank.specimens : []).filter((s) => !s.isBatchPlaceholder);
  const volumeGallons = Math.round(Number(tank?.volumeLiters) * LITERS_TO_GALLONS) || 0;
  const fishCount = living.length;

  const base = {
    applicable: false,
    volumeGallons,
    fishCount,
    knownCount: 0,
    unknownCount: 0,
    totalAdultLengthCm: 0,
    capacityLengthCm: 0,
    ratio: null,
    band: null,
    assumptions: [],
  };

  if (fishCount === 0 || volumeGallons <= 0) return base;

  const groups = groupNurseryFish(living);
  let totalAdultLengthCm = 0;
  let knownCount = 0;
  let unknownCount = 0;

  for (const g of groups) {
    const profile = deriveSpeciesProfile(g, fishbaseData, contractSpecies);
    const adult = Number(profile?.adultSizeCm);
    if (Number.isFinite(adult) && adult > 0) {
      totalAdultLengthCm += adult * g.count;
      knownCount += g.count;
    } else {
      unknownCount += g.count;
    }
  }

  const capacityLengthCm = volumeGallons * CM_PER_INCH;
  const assumptions = [
    "Rough guide only — the \u201c1 inch of adult fish per gallon\u201d rule ignores body mass, bioload, filtration and territory. Use it as a starting point, not a hard limit.",
  ];
  if (unknownCount > 0) {
    assumptions.push(`${unknownCount} fish excluded — no confirmed adult size for ${unknownCount === 1 ? "it" : "them"} in the catalog.`);
  }

  // No adult-size data for anything → report counts but no ratio/band.
  if (knownCount === 0) {
    return { ...base, applicable: true, capacityLengthCm, unknownCount, assumptions };
  }

  const ratio = capacityLengthCm > 0 ? totalAdultLengthCm / capacityLengthCm : null;
  return {
    applicable: true,
    volumeGallons,
    fishCount,
    knownCount,
    unknownCount,
    totalAdultLengthCm: Math.round(totalAdultLengthCm * 10) / 10,
    capacityLengthCm: Math.round(capacityLengthCm * 10) / 10,
    ratio,
    band: bandFor(ratio),
    assumptions,
  };
}

/** Headline + tone for a stocking band. */
export function stockingHeadline(band) {
  switch (band) {
    case "comfortable": return { icon: "🐟", tone: "ok", text: "Comfortably stocked" };
    case "stocked": return { icon: "🐠", tone: "ok", text: "Well stocked" };
    case "full": return { icon: "⚠️", tone: "warn", text: "Approaching full" };
    case "over": return { icon: "⚠️", tone: "alert", text: "Likely overstocked" };
    default: return { icon: "🐟", tone: "neutral", text: "Stocking" };
  }
}
