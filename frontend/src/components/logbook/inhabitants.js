/**
 * inhabitants.js — what kind of animal (or plant) a tank inhabitant is, and the
 * catalog facts the tank screens show for it. Pure; no React.
 *
 * A reef tank holds fish, corals and invertebrates. They were all counted and
 * drawn as "fish", so a reef with seven corals read "15 fish", swam grey fish
 * silhouettes for the zoanthids, and ran the fish-length stocking rule on
 * corals. The catalog already says what each record is (`type`: "fish",
 * "coral", "invertebrate", "plant", "amphibian"; blank means fish), so the tank
 * screens read it from here instead of guessing.
 */

import { reefFit } from "../../services/addOnRecommender.js";
import { resolveRecord, resolveSpecies } from "../../services/catalogAliases.js";

const lower = (v) => String(v || "").trim().toLowerCase();

/**
 * The catalog record for a tank inhabitant. Scientific name first (the stable
 * key across the on-chain and curated catalogs), then the exact common name,
 * then the catalog specCode. The specCode is last on purpose: on-chain species
 * ids are small integers that can collide with an unrelated specCode.
 */
export function speciesRecordFor(spec, fishbaseData = []) {
  if (!spec || !Array.isArray(fishbaseData) || fishbaseData.length === 0) return null;
  // A record marked duplicateOf another (an older name) resolves to the
  // canonical record, so an inhabitant saved under the old ID or name still
  // gets the current care data (services/catalogAliases.js).
  const sci = lower(spec.scientificName);
  if (sci && sci !== "unknown") {
    const bySci = fishbaseData.find((r) => lower(r?.scientificName) === sci);
    if (bySci) return resolveRecord(bySci, fishbaseData);
  }
  if (spec.commonName) {
    const byName = fishbaseData.find((r) => r?.commonName && r.commonName === spec.commonName);
    if (byName) return resolveRecord(byName, fishbaseData);
  }
  const id = Number(spec.speciesId);
  if (Number.isFinite(id) && id > 0) {
    return resolveSpecies(id, fishbaseData);
  }
  return null;
}

/** "fish" | "coral" | "invertebrate" | "plant" | "amphibian" for one inhabitant. */
export function inhabitantKind(spec, fishbaseData = []) {
  const type = lower(speciesRecordFor(spec, fishbaseData)?.type);
  if (type === "coral" || type === "invertebrate" || type === "plant" || type === "amphibian") return type;
  return "fish";
}

/** Icon for an inhabitant kind, used where there is no photo. */
export function kindIcon(kind) {
  switch (kind) {
    case "coral": return "🪸";
    case "invertebrate": return "🦐";
    case "plant": return "🌿";
    case "amphibian": return "🦎";
    default: return "🐠";
  }
}

/** Living (non-placeholder, active) inhabitants of a tank. */
export function livingInhabitants(tank) {
  return (Array.isArray(tank?.specimens) ? tank.specimens : [])
    .filter((s) => s && !s.isBatchPlaceholder && Number(s.status ?? 0) === 0);
}

/** Counts by kind: { fish, coral, invertebrate, plant, amphibian, total }. */
export function countInhabitants(tank, fishbaseData = []) {
  const counts = { fish: 0, coral: 0, invertebrate: 0, plant: 0, amphibian: 0, total: 0 };
  for (const s of livingInhabitants(tank)) {
    counts[inhabitantKind(s, fishbaseData)] += 1;
    counts.total += 1;
  }
  return counts;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * "8 fish · 7 corals · 5 inverts". Zero kinds are left out; an empty tank reads
 * "No fish yet" (or "Empty" in Pro).
 */
export function inhabitantSummary(counts, { casual = true } = {}) {
  const c = counts || {};
  const parts = [];
  if (c.fish) parts.push(plural(c.fish, "fish", "fish"));
  if (c.coral) parts.push(plural(c.coral, "coral", "corals"));
  if (c.invertebrate) parts.push(plural(c.invertebrate, "invert", "inverts"));
  if (c.plant) parts.push(plural(c.plant, "plant", "plants"));
  if (c.amphibian) parts.push(plural(c.amphibian, "amphibian", "amphibians"));
  if (parts.length === 0) return casual ? "No fish yet" : "Empty";
  return parts.join(" · ");
}

/** Only the swimmers: what the fish animation should draw. */
export function swimmingInhabitants(specimens = [], fishbaseData = []) {
  return (specimens || []).filter((s) => {
    const kind = inhabitantKind(s, fishbaseData);
    return kind === "fish" || kind === "amphibian";
  });
}

/** Same slug rule as species.html / database.html `toSlug`, for /species/<slug>. */
export function speciesSlug(scientificName) {
  return lower(scientificName).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Public care page path for an inhabitant, or "" when there is no scientific name. */
export function speciesCarePath(spec, fishbaseData = []) {
  const record = speciesRecordFor(spec, fishbaseData);
  const sci = record?.scientificName || (lower(spec?.scientificName) !== "unknown" ? spec?.scientificName : "");
  const slug = speciesSlug(sci);
  return slug ? `/species/${slug}` : "";
}

/** Catalog photo for an inhabitant ("" when the catalog has none). */
export function speciesPhotoFor(spec, fishbaseData = []) {
  return speciesRecordFor(spec, fishbaseData)?.masterPhotoUrl || "";
}

const CORAL_TYPE_LABEL = { sps: "SPS", lps: "LPS", soft: "Soft coral", zoanthid: "Zoanthid", mushroom: "Mushroom", anemone: "Anemone" };
const CARE_WORD = { low: "Low", medium: "Medium", high: "High", any: "Anywhere", top: "Top", middle: "Middle", bottom: "Bottom" };
const word = (v) => CARE_WORD[lower(v)] || (v ? String(v) : null);

/**
 * Coral care from the catalog (light / flow / placement / type), or null for
 * anything that isn't a coral. Values are the catalog's own, never inferred.
 */
export function coralCare(spec, fishbaseData = []) {
  const record = speciesRecordFor(spec, fishbaseData);
  if (lower(record?.type) !== "coral" || !record?.marine) return null;
  const m = record.marine;
  return {
    coralType: CORAL_TYPE_LABEL[lower(m.coralType)] || m.coralType || null,
    light: word(m.light),
    flow: word(m.flow),
    placement: word(m.placement),
    aggression: m.aggression || null,
  };
}

/** Invert role/notes from the catalog, or null. */
export function invertCare(spec, fishbaseData = []) {
  const record = speciesRecordFor(spec, fishbaseData);
  if (lower(record?.type) !== "invertebrate") return null;
  const m = record.marine || {};
  return { role: m.role || null, reefSafe: m.reefSafe || null };
}

/**
 * Whether a species can go in a tank, for the add-to-tank picker. Uses the same
 * rule as Fish Finder (services/addOnRecommender.js reefFit): corals and
 * anemones need a reef; a species marked not reef safe is a caution in a reef.
 * @returns {{ verdict: ("ok"|"caution"|"blocked"), reason: (string|null) }}
 */
export function reefPlacement(record, tank) {
  if (!record || Number(tank?.tankType) !== 1) return { verdict: "ok", reason: null };
  const m = record.marine || {};
  const profile = {
    requiresReef: m.requiresReef === true || lower(record.type) === "coral",
    reefSafe: m.reefSafe ? lower(m.reefSafe) : null,
  };
  return reefFit(profile, { waterType: "marine", reef: tank?.marineStyle !== "fish_only" });
}
