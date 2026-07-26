/**
 * discoveryIntents.js — the deterministic core of "Find my next fish" (Fish
 * Finder Rework, Task 7).
 *
 * Why deterministic, not AI-driven (see FISH_FINDER_T7_SPEC.md §2): the
 * existing `useSpeciesSearch` facets (type/difficulty/tempBucket/phBucket/
 * origin) can't express "peaceful" or "cleanup crew", and `useNaturalSearch`'s
 * AI-parsed filter vocabulary doesn't match those facet keys. Rather than
 * bridge two mismatched, partially-AI systems, this module is a small, pure,
 * unit-tested predicate engine directly over the real catalog record fields.
 *
 * Every predicate is grounded in a documented field from the curated master
 * catalog (`fishbase_master.json`) — never a fabricated signal. When the data
 * a predicate needs is unknown for a species, that species is EXCLUDED from
 * the intent, never guessed in. This mirrors the "unknown ≠ guessed" rule the
 * rest of Fish Finder's fit/stocking engines already follow.
 *
 * Pure and dependency-light: no React, no I/O.
 */

import { normalizeDifficulty } from "../../services/speciesCatalog.js";

// ─── Intent taxonomy (exactly six — do not add a "colorful" intent; there is
// no color data in the catalog, and inventing one would fabricate matches) ──

export const DISCOVERY_INTENTS = Object.freeze([
  { id: "beginner", label: "Beginner-friendly", icon: "🌱" },
  { id: "peaceful", label: "Peaceful community", icon: "🕊️" },
  // "Nano-friendly" rather than "Nano / small tanks": keeps the Casual
  // container noun consistent ("aquarium", per finderCopy.js) without the
  // clumsier "Nano / small aquariums".
  { id: "nano", label: "Nano-friendly", icon: "🫧" },
  { id: "centerpiece", label: "Centerpiece", icon: "⭐" },
  { id: "cleanup", label: "Cleanup crew", icon: "🧹" },
  { id: "coldwater", label: "Coldwater (no heater)", icon: "❄️" },
]);

const INTENT_IDS = new Set(DISCOVERY_INTENTS.map((i) => i.id));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isNum(v) {
  return v != null && v !== "" && Number.isFinite(Number(v));
}

/**
 * Resolve the curated master record for a catalog entry (global or contract
 * shape), matched on lowercased scientificName — exactly the join
 * `speciesProfileForFit` uses, so predicates see the same rich fields
 * regardless of which catalog the entry came from.
 * @param {Object} entry
 * @param {Array} fishbaseData
 * @returns {Object|null}
 */
function resolveMasterRecord(entry, fishbaseData = []) {
  if (!entry) return null;
  const name = String(entry.scientificName || "").toLowerCase();
  if (!name) return null;
  return fishbaseData.find((f) => f && f.scientificName && f.scientificName.toLowerCase() === name) || null;
}

function normalizedIntentText(...parts) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

const PEACEFUL_RE = /peace|community|shoal|school/;
const AGGRESSIVE_RE = /aggress|territorial|predator|fin.?nip/;
const CLEANUP_TEXT_RE = /algae|detritus|biofilm/;
const CLEANUP_FAMILIES = new Set(["loricariidae", "callichthyidae"]);

// ─── Per-intent predicates ───────────────────────────────────────────────────
//
// Each predicate receives (entry, master) — `master` may be null. Every
// predicate that needs master-record data returns false (excludes) when that
// data is missing, per the "never fabricate a match" rule.

// Is a species "Easy"/"Beginner" difficulty? Checks the entry's own numeric
// `careLevel` (0 = easy — the shape both global entries via toCatalogEntry
// and on-chain contract entries carry), then the master record's raw
// `tankMetrics.difficulty` string via the canonical `normalizeDifficulty`
// (speciesCatalog.js). Equivalent to useSpeciesSearch.js's
// `getDifficultyNormalized(item) === "Easy"`, reimplemented locally to avoid
// importing that hook file (it transitively pulls in an ethers/window shim
// unavailable outside the browser).
function isEasyDifficulty(entry, master) {
  if (Number.isFinite(Number(entry?.careLevel)) && Number(entry.careLevel) === 0) return true;
  if (master?.tankMetrics?.difficulty) return normalizeDifficulty(master.tankMetrics.difficulty).key === "beginner";
  return false;
}

const INTENT_PREDICATES = Object.freeze({
  beginner(entry, master) {
    return isEasyDifficulty(entry, master);
  },

  peaceful(entry, master) {
    const text = normalizedIntentText(master?.ecology?.socialBehavior, master?.behavior?.temperament);
    if (!text) return false; // unknown → excluded, never guessed in
    return PEACEFUL_RE.test(text) && !AGGRESSIVE_RE.test(text);
  },

  nano(entry, master) {
    const size = isNum(master?.maxLengthCm) ? Number(master.maxLengthCm) : null;
    const minVol = isNum(master?.tankMetrics?.minVolumeGallons) ? Number(master.tankMetrics.minVolumeGallons) : null;
    if (size == null && minVol == null) return false; // both unknown → excluded
    return (size != null && size <= 5) || (minVol != null && minVol <= 10);
  },

  centerpiece(entry, master) {
    const size = isNum(master?.maxLengthCm) ? Number(master.maxLengthCm) : null;
    if (size == null) return false; // unknown → excluded
    return size >= 12;
  },

  cleanup(entry, master) {
    if (master?.type === "plant") return true;
    const trophic = master?.diet?.trophicLevel;
    if (trophic === "Herbivore") return true;
    const family = String(master?.family || "").toLowerCase();
    if (CLEANUP_FAMILIES.has(family)) return true;
    const text = normalizedIntentText(master?.diet?.fooditems, master?.ecology?.comments);
    if (text && CLEANUP_TEXT_RE.test(text)) return true;
    return false; // no positive signal and nothing else known → excluded
  },

  coldwater(entry, master) {
    const maxTemp = master?.tankMetrics?.tempRangeCelsius?.[1];
    if (!isNum(maxTemp)) return false; // unknown → excluded
    return Number(maxTemp) < 22;
  },
});

/**
 * Does a catalog entry match a discovery intent? Resolves the master record
 * internally (see resolveMasterRecord) so contract entries get the same rich
 * fields as global entries.
 * @param {Object} entry - catalog entry (global or contract shape)
 * @param {string} intentId - one of DISCOVERY_INTENTS ids
 * @param {Object} [opts]
 * @param {Array}  [opts.fishbaseData]
 * @returns {boolean}
 */
export function speciesMatchesIntent(entry, intentId, { fishbaseData = [] } = {}) {
  if (!entry || !intentId || !INTENT_IDS.has(intentId)) return false;
  const predicate = INTENT_PREDICATES[intentId];
  if (!predicate) return false;
  const master = resolveMasterRecord(entry, fishbaseData);
  return !!predicate(entry, master);
}

/**
 * Filter a list of catalog entries down to those matching a discovery
 * intent. A null/unknown intentId returns all entries unchanged (the "no
 * filter active" case).
 * @param {Array} entries
 * @param {string|null} intentId
 * @param {Object} [opts]
 * @param {Array}  [opts.fishbaseData]
 * @returns {Array}
 */
export function filterByIntent(entries, intentId, { fishbaseData = [] } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (!intentId || !INTENT_IDS.has(intentId)) return list;
  return list.filter((entry) => speciesMatchesIntent(entry, intentId, { fishbaseData }));
}
