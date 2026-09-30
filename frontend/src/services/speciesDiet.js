/**
 * speciesDiet.js
 *
 * Pure helpers for reading a species record's diet without inventing one.
 *
 * About 70 catalog records have no trophic level at all (plants, most
 * inverts, and a set of fish FishBase never scored). The app used to backfill
 * those with "Omnivore", which then fed the "Easy Feeder" card tag, Poseidon's
 * species context, listing description drafts and shipping-safety confidence.
 * A missing diet now stays null everywhere; display code decides whether to
 * hide the slot or show DIET_NOT_RECORDED.
 */

/** Plain label for a display slot that must be filled when no diet is on record. */
export const DIET_NOT_RECORDED = "Diet not recorded";

// Placeholder strings older code wrote into diet fields. None of them are data.
const DIET_PLACEHOLDERS = new Set([
  "information arriving soon",
  "generic biotope details",
  "n/a",
  "na",
  "unknown",
  "none",
  "-",
  "—",
]);

/**
 * Return a trimmed diet string, or null when the value is missing, not a
 * string, empty, or a known placeholder.
 * @param {*} value
 * @returns {string|null}
 */
export function realDietText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || DIET_PLACEHOLDERS.has(text.toLowerCase())) return null;
  return text;
}

/**
 * Normalize a raw `diet` object. Every field is a real string or null.
 * @param {Object|null|undefined} diet
 * @returns {{ trophicLevel: (string|null), fooditems: (string|null), feedingPlaybook: (string|null) }}
 */
export function normalizeDiet(diet) {
  return {
    trophicLevel: realDietText(diet?.trophicLevel),
    fooditems: realDietText(diet?.fooditems),
    feedingPlaybook: realDietText(diet?.feedingPlaybook),
  };
}

/** Lowercased word tokens of a trophic level ("Carnivore / Piscivore" -> ["carnivore","piscivore"]). */
function trophicTokens(trophicLevel) {
  const text = realDietText(trophicLevel);
  if (!text) return [];
  return text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

/**
 * True only when the recorded trophic level names a carnivore or piscivore.
 * Null / missing is never a carnivore (and never an omnivore).
 */
export function isCarnivoreTrophic(trophicLevel) {
  const tokens = trophicTokens(trophicLevel);
  return tokens.includes("carnivore") || tokens.includes("piscivore");
}

/** True only when the recorded trophic level names a herbivore. */
export function isHerbivoreTrophic(trophicLevel) {
  return trophicTokens(trophicLevel).includes("herbivore");
}

/**
 * True only when the recorded trophic level is exactly "Omnivore"
 * (case-insensitive). Mixed labels like "Omnivore/Detritivore" do not count,
 * matching the original Easy Feeder rule. Null never matches.
 */
export function isPlainOmnivore(trophicLevel) {
  const text = realDietText(trophicLevel);
  return text != null && text.toLowerCase() === "omnivore";
}
