/**
 * speciesCardTags.js
 *
 * Casual-mode tag chips for SpeciesCardPremium. Pure so it can be tested
 * without rendering the card (which pulls in BreedGallery and window.ethers).
 *
 * Every tag must be backed by a recorded value:
 *   - "Schooling" needs socialBehavior text that mentions schooling
 *   - "Easy Feeder" needs a recorded trophic level of exactly "Omnivore" and
 *     never applies to plants or corals (they are not fed like fish)
 *   - "Beginner Friendly" needs an on-chain careLevel of 0
 */

import { isPlainOmnivore } from "./speciesDiet.js";

const NON_FED_TYPES = new Set(["plant", "coral"]);

/**
 * @param {Object|null|undefined} profile - the matched catalog record
 * @param {{ careLevel?: number, isPlant?: boolean }} [opts]
 * @returns {string[]} at most two tags
 */
export function casualCardTags(profile, opts = {}) {
  if (!profile) return [];
  const tags = [];
  const social = profile.ecology?.socialBehavior;
  if (typeof social === "string" && social.toLowerCase().includes("school")) tags.push("Schooling");

  const notFed = opts.isPlant === true || NON_FED_TYPES.has(profile.type);
  if (!notFed && isPlainOmnivore(profile.diet?.trophicLevel)) tags.push("Easy Feeder");

  if (opts.careLevel === 0) tags.push("Beginner Friendly");
  return tags.slice(0, 2);
}
