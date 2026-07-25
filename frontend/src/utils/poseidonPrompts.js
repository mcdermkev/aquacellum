/**
 * poseidonPrompts.js — grounded prompt builders for the inline "Ask Poseidon"
 * tips (Logbook Rework Task 10, Knowledge layer).
 *
 * These build the *question* seeded into the existing Poseidon console from
 * REAL tank data only — flagged parameters with their observed values and the
 * tank's own target ranges, or a resident species' name. They never assert care
 * facts themselves; they just frame a grounded question. The console's server
 * side (curated-catalog RAG + its "never fabricate care parameters" system
 * prompt) produces the answer, and any write it proposes still routes through
 * the console's confirm-before-write action bar.
 *
 * Pure and dependency-light.
 */

import { tankTypeLabel } from "./tankUtils";

function typeWord(tank) {
  return String(tankTypeLabel(tank?.tankType) || "freshwater").toLowerCase();
}

/**
 * Build a grounded "what should I do?" question from the current health flags.
 * @param {object} tank
 * @param {Array<{label:string, observed:string, target:string}>} items  explainTankFlags items
 * @returns {string}
 */
export function buildFlagFixPrompt(tank, items = []) {
  const type = typeWord(tank);
  if (!Array.isArray(items) || items.length === 0) {
    return `My ${type} tank looks healthy right now — is there anything I should keep an eye on?`;
  }
  const lines = items
    .map((i) => `${i.label} (${i.observed}, target ${i.target})`)
    .join("; ");
  return `My ${type} tank currently shows: ${lines}. In plain terms, what should I do first and why? Please base your answer only on these readings.`;
}

/**
 * Build a grounded species care question for a resident fish.
 * @param {string} commonName
 * @param {object} tank
 * @returns {string}
 */
export function buildSpeciesCarePrompt(commonName, tank) {
  const name = String(commonName || "this species").trim();
  const type = typeWord(tank);
  return `What are the key care needs for ${name} in my ${type} tank? Focus on water parameters, tank size, and temperament.`;
}
