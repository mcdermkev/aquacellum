/**
 * savedSearches.js — the saved-search store, and the one definition of its shape.
 *
 * THE GAP THIS CLOSES. `aquadex_saved_searches` was WRITE-ONLY. The only two
 * references to the key in the whole codebase were both inside
 * `MarketplaceBoard.saveCurrentSearch()`, which appended to it. Nothing ever read a
 * saved search back to re-apply it. So "Save this search" stored data the user
 * could never use — and `saved_search` is an EARNED entitlement (Coastal), meaning
 * people spent XP progress unlocking a button that did nothing.
 *
 * WHY A MODULE RATHER THAN INLINE localStorage. Three call sites now touch this
 * data — the board (save), Settings (list/remove/apply), and the board again
 * (apply). Each reading the raw key would mean three places that must agree on the
 * record shape, and the Settings section had already grown its own duplicate
 * `describeSavedSearch`. One module keeps the shape, the labelling and the cap in a
 * single place.
 *
 * RECORD SHAPE is fixed by what already exists in users' browsers, so it is
 * additive-only:
 *   { search, family, careLevel, fulfillment, priceMinInput, priceMaxInput, savedAt }
 * Older records may be missing fields; `normalizeSearch()` fills them so a
 * partially-shaped legacy record still applies cleanly rather than leaving stale
 * filters behind.
 */

export const SAVED_SEARCHES_KEY = "aquadex_saved_searches";

/** Upper bound so the list stays usable and localStorage stays small. */
export const MAX_SAVED_SEARCHES = 20;

/** The filter set a saved search restores, with the board's own defaults. */
const FILTER_DEFAULTS = Object.freeze({
  search: "",
  family: "all",
  careLevel: "all",
  fulfillment: "all",
  priceMinInput: "",
  priceMaxInput: "",
});

function safeLocalStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Fill any missing filter keys with the board's defaults.
 *
 * ⚠️ This is what makes applying a saved search deterministic. Without it, a legacy
 * record missing `fulfillment` would leave whatever the user had selected in place,
 * so the restored results would not match what they saved — the filter set has to
 * be complete, not partial.
 *
 * @param {object} entry
 * @returns {object} a full filter set
 */
export function normalizeSearch(entry = {}) {
  return {
    search: entry.search ?? FILTER_DEFAULTS.search,
    family: entry.family ?? FILTER_DEFAULTS.family,
    careLevel: entry.careLevel ?? FILTER_DEFAULTS.careLevel,
    fulfillment: entry.fulfillment ?? FILTER_DEFAULTS.fulfillment,
    priceMinInput: entry.priceMinInput ?? FILTER_DEFAULTS.priceMinInput,
    priceMaxInput: entry.priceMaxInput ?? FILTER_DEFAULTS.priceMaxInput,
  };
}

/**
 * @param {Storage} [storage]
 * @returns {Array<object>} saved searches, newest last (insertion order preserved)
 */
export function loadSavedSearches(storage = safeLocalStorage()) {
  if (!storage) return [];
  try {
    const raw = JSON.parse(storage.getItem(SAVED_SEARCHES_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    // Corrupt JSON reads as empty rather than throwing into a render.
    return [];
  }
}

function persist(list, storage) {
  if (!storage) return;
  try {
    storage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // non-fatal (quota / private browsing)
  }
}

/**
 * Append a search, de-duplicating an identical filter set.
 *
 * De-duplication matters because the save button is one click with no feedback
 * about what is already stored — without it, clicking twice on the same filters
 * silently produces two identical rows the user then has to delete twice.
 *
 * @returns {Array<object>} the updated list
 */
export function addSavedSearch(filters, storage = safeLocalStorage()) {
  const normalized = normalizeSearch(filters);
  const list = loadSavedSearches(storage);

  const existingIndex = list.findIndex(
    (entry) => describeSavedSearch(entry) === describeSavedSearch(normalized)
  );
  if (existingIndex !== -1) {
    // Refresh its timestamp rather than adding a duplicate.
    list[existingIndex] = { ...normalized, savedAt: Date.now() };
    persist(list, storage);
    return list;
  }

  list.push({ ...normalized, savedAt: Date.now() });
  // Drop the oldest beyond the cap.
  const capped = list.slice(-MAX_SAVED_SEARCHES);
  persist(capped, storage);
  return capped;
}

/**
 * @returns {Array<object>} the updated list
 */
export function removeSavedSearch(index, storage = safeLocalStorage()) {
  const list = loadSavedSearches(storage);
  if (index < 0 || index >= list.length) return list;
  const next = list.filter((_, i) => i !== index);
  persist(next, storage);
  return next;
}

/**
 * Build a readable one-line summary of a saved filter set, used as its label in
 * Settings and as its de-duplication identity above.
 */
export function describeSavedSearch(entry = {}) {
  const e = normalizeSearch(entry);
  const parts = [];
  if (e.search) parts.push(`"${e.search}"`);
  if (e.family && e.family !== "all") parts.push(e.family);
  if (e.careLevel && e.careLevel !== "all") parts.push(e.careLevel);
  if (e.fulfillment && e.fulfillment !== "all") parts.push(e.fulfillment);

  const min = e.priceMinInput;
  const max = e.priceMaxInput;
  if (min && max) parts.push(`$${min}–$${max}`);
  else if (min) parts.push(`from $${min}`);
  else if (max) parts.push(`up to $${max}`);

  return parts.length > 0 ? parts.join(" · ") : "All listings";
}

export default {
  SAVED_SEARCHES_KEY,
  MAX_SAVED_SEARCHES,
  loadSavedSearches,
  addSavedSearch,
  removeSavedSearch,
  describeSavedSearch,
  normalizeSearch,
};
