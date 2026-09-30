/**
 * speciesCare.js
 *
 * Pure helpers for reading a species record's non-diet care facts (family,
 * ecology, reproduction, pH / temperature numbers) without inventing any.
 * The companion of services/speciesDiet.js.
 *
 * The catalog normalizer used to backfill missing fields with invented values:
 * pH 6.5 to 7.5, "5 - 15 dGH", a 28 C ceiling, "Generic Biotope Details" and
 * "Information arriving soon". The pH numbers fed tank fit checks, so a species
 * with no pH on record "fit" any 6.5 to 7.5 tank. A missing value now stays
 * null everywhere; display code hides the slot or shows CARE_NOT_RECORDED, and
 * checks report "unknown" instead of a pass.
 */

/** Plain label for a display slot that must be filled when nothing is on record. */
export const CARE_NOT_RECORDED = "Not recorded";

// Placeholder strings older code wrote into care fields. None of them are data.
const CARE_PLACEHOLDERS = new Set([
  "information arriving soon",
  "generic biotope details",
  "no data available.",
  "no data available",
  "n/a",
  "na",
  "unknown",
  "none",
  "-",
  "—",
  "?",
]);

/**
 * Return the text as recorded, or null when the value is missing, not a
 * string, blank, or a known placeholder. Real text is returned untouched.
 * @param {*} value
 * @returns {string|null}
 */
export function realCareText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || CARE_PLACEHOLDERS.has(text.toLowerCase())) return null;
  return value;
}

/**
 * Return a finite number, or null. Null / undefined / "" are checked before
 * Number() because Number(null) is 0, which would read as a real pH of 0.
 * @param {*} value
 * @returns {number|null}
 */
export function realCareNumber(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * A [min, max] pair when both ends are real numbers, else null.
 * @returns {[number, number]|null}
 */
export function realRange(min, max) {
  const lo = realCareNumber(min);
  const hi = realCareNumber(max);
  return lo != null && hi != null ? [lo, hi] : null;
}

/**
 * Normalize a raw `ecology` object. Numbers derived from the record's own
 * tankMetrics (phRange, tempRangeCelsius) are real data and are kept.
 * @param {Object|null|undefined} ecology
 * @param {Object|null|undefined} tankMetrics
 */
export function normalizeEcology(ecology, tankMetrics) {
  return {
    comments: realCareText(ecology?.comments),
    biotope: realCareText(ecology?.biotope),
    phMin: realCareNumber(ecology?.phMin) ?? realCareNumber(tankMetrics?.phRange?.[0]),
    phMax: realCareNumber(ecology?.phMax) ?? realCareNumber(tankMetrics?.phRange?.[1]),
    hardnessRange: realCareText(ecology?.hardnessRange),
    tempCeiling: realCareNumber(ecology?.tempCeiling) ?? realCareNumber(tankMetrics?.tempRangeCelsius?.[1]),
    socialBehavior: realCareText(ecology?.socialBehavior),
  };
}

/**
 * Normalize a raw `reproduction` object. Every field is real text or null.
 * @param {Object|null|undefined} reproduction
 */
export function normalizeReproduction(reproduction) {
  return {
    spawningTrait: realCareText(reproduction?.spawningTrait),
    layoutRequirement: realCareText(reproduction?.layoutRequirement),
    comments: realCareText(reproduction?.comments),
  };
}

function isRangePair(r) {
  return Array.isArray(r) && r.length === 2 && realRange(r[0], r[1]) != null;
}

// On-chain and listing records store an unset range as 0 / 0.
function flatRange(min, max) {
  const r = realRange(min, max);
  return r && !(r[0] === 0 && r[1] === 0) ? r : null;
}

/**
 * Honest temperature and pH ranges for a Fish Finder catalog entry.
 *
 * Global entries (services/speciesCatalog.js toCatalogEntry) carry flat
 * minTemp / maxTemp / minPh / maxPh that fall back to display defaults
 * (22 to 28 C, pH 6.5 to 7.5) when the species has no curated range; their
 * `profile` holds the real ranges or null, so it wins when present. On-chain
 * contract entries have no profile, and their flat fields are real (0 / 0 = unset).
 *
 * @param {Object|null|undefined} entry
 * @returns {{ tempRange: ([number,number]|null), phRange: ([number,number]|null) }}
 */
export function entryCareRanges(entry) {
  if (!entry) return { tempRange: null, phRange: null };
  if (entry.profile && typeof entry.profile === "object") {
    return {
      tempRange: isRangePair(entry.profile.tempRange) ? realRange(...entry.profile.tempRange) : null,
      phRange: isRangePair(entry.profile.phRange) ? realRange(...entry.profile.phRange) : null,
    };
  }
  return {
    tempRange: flatRange(entry.minTemp, entry.maxTemp),
    phRange: flatRange(entry.minPh, entry.maxPh),
  };
}

/**
 * Recorded temperature and pH ranges for any catalog-shaped item: a Fish
 * Finder entry (see entryCareRanges) or a raw / normalized fishbase record
 * (tankMetrics). Used by range filters, so a missing range never matches.
 * A lone ecology.tempCeiling is a ceiling, not a range, and is not widened
 * into one.
 * @param {Object|null|undefined} item
 * @returns {{ tempRange: ([number,number]|null), phRange: ([number,number]|null) }}
 */
export function recordedCareRanges(item) {
  if (!item) return { tempRange: null, phRange: null };
  const tm = item.tankMetrics;
  const fromMetrics = {
    tempRange: realRange(tm?.tempRangeCelsius?.[0], tm?.tempRangeCelsius?.[1]),
    phRange: realRange(tm?.phRange?.[0], tm?.phRange?.[1]),
  };
  const isEntry = item.profile != null ||
    item.minTemp != null || item.maxTemp != null || item.minPh != null || item.maxPh != null;
  if (!isEntry) return fromMetrics;
  const fromEntry = entryCareRanges(item);
  return {
    tempRange: fromEntry.tempRange ?? fromMetrics.tempRange,
    phRange: fromEntry.phRange ?? fromMetrics.phRange,
  };
}

/**
 * Check one reading against a species range. A missing range or a missing
 * reading is "unknown", never a pass.
 * @param {*} value - the tank reading
 * @param {[number, number]|null|undefined} range - species [min, max]
 * @param {number} [tolerance=0] - slack added to both ends
 * @returns {'pass'|'fail'|'unknown'}
 */
export function checkRange(value, range, tolerance = 0) {
  const v = realCareNumber(value);
  const r = Array.isArray(range) ? realRange(range[0], range[1]) : null;
  if (v == null || r == null) return "unknown";
  return v >= r[0] - tolerance && v <= r[1] + tolerance ? "pass" : "fail";
}

/**
 * Format a [min, max] range for display, or null when either end is missing.
 * @param {*} min
 * @param {*} max
 * @param {string} [dash=" - "]
 * @returns {string|null}
 */
export function formatCareRange(min, max, dash = " - ") {
  const r = realRange(min, max);
  return r ? `${r[0]}${dash}${r[1]}` : null;
}
