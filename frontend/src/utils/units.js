/**
 * units.js — user-facing unit preferences and the formatters that honour them.
 *
 * Two preferences (docs/SETTINGS_SPEC.md §6 #5, the `units` section):
 *
 *   `aquadex_distance_unit`  "mi" | "km"          default "mi"
 *   `aquadex_temp_unit`      "both" | "c" | "f"   default "both"
 *
 * ⚠️ `aquadex_distance_unit` ALREADY EXISTED and this module must stay
 * bug-compatible with it. It was written by `LocalBreederMap.jsx`, which stores
 * the literal strings "km"/"mi" — and which `App.jsx` notes is retired and no
 * longer imported, so the key had a writer and no reachable reader. That is the
 * orphaned-preference case from the handoff §3.5; the Units section plus
 * `formatDistance()` below is what gives it a real one. Do not change the stored
 * values to a boolean/metric flag: an existing user's saved "km" must keep
 * meaning km.
 *
 * ⚠️ The temperature default is "both", NOT "c" or "f", and that is deliberate.
 * The app currently renders BOTH units everywhere it shows a temperature —
 * `24.5°C (76.1°F)` in ActivityLog, `24.5°C / 76.1°F` in the TankList telemetry
 * tile. Defaulting to "both" means adding this preference changes nothing for
 * anyone until they choose, so shipping it cannot regress a display that
 * currently works. The preference's job is to let people who only think in one
 * scale drop the noise.
 *
 * Formatting is exposed as `showCelsius()` / `showFahrenheit()` predicates rather
 * than one all-in-one string formatter, because the two existing call sites style
 * the two readings differently (TankList renders the °C large and the °F small and
 * muted). Predicates let each site keep its own layout and simply omit a reading,
 * so the "both" default is pixel-identical to today.
 */

export const DISTANCE_UNIT_KEY = "aquadex_distance_unit";
export const TEMP_UNIT_KEY = "aquadex_temp_unit";
export const VOLUME_UNIT_KEY = "aquadex_volume_unit";

export const DISTANCE_UNITS = Object.freeze(["mi", "km"]);
export const TEMP_UNITS = Object.freeze(["both", "c", "f"]);
export const VOLUME_UNITS = Object.freeze(["gal", "l"]);

export const DEFAULT_DISTANCE_UNIT = "mi";
export const DEFAULT_TEMP_UNIT = "both";

/**
 * Gallons, not litres.
 *
 * This is not a guess about the audience — it is what the app already asks for.
 * EVERY tank-volume input is labelled in gallons ("Volume (gal)" in
 * BulkTankModal, "Volume (Gallons)" in FacilityTreeView, "Size (gal)" in
 * GrowoutTankPanel, the CSV importer's gallons column) and each one multiplies by
 * 3.78541 before storing. Storage is litres and correctly so; the DISPLAY then
 * showed litres too, so a keeper typed 20 and their tank card read "76L".
 *
 * That is the reported confusion, and it is also an internal contradiction:
 * StockingGuidance already showed "20 gal" for the very tank whose card said
 * "76L". Defaulting to gallons makes the display agree with both the input and
 * the stocking panel. It also matches the existing "mi" distance default.
 */
export const DEFAULT_VOLUME_UNIT = "gal";

/** Fired after any unit preference changes, so mounted consumers re-read. */
export const UNITS_CHANGED_EVENT = "aquadex:units-changed";

const MILES_TO_KM = 1.60934;

/**
 * US liquid gallons. The same constant every write path already uses
 * (3.78541), inverted here so a round trip cannot drift.
 */
const LITERS_TO_GALLONS = 1 / 3.78541;

/**
 * Coerce to a finite number, or null.
 *
 * ⚠️ Deliberately stricter than `Number()`. `Number(null)` and `Number("")` are
 * both `0`, which is finite — so a naive `Number.isFinite(Number(x))` guard would
 * render a MISSING temperature as "0.0°C". In a logbook that is worse than
 * rendering nothing: 0°C is a plausible-looking reading, so the display would be
 * confidently wrong about the tank rather than visibly empty. Absent stays absent.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeLocalStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

// ─── Preference load / persist ───────────────────────────────────────────────

/**
 * @param {Storage} [storage]
 * @returns {"mi"|"km"}
 */
export function loadDistanceUnit(storage = safeLocalStorage()) {
  if (!storage) return DEFAULT_DISTANCE_UNIT;
  try {
    const raw = storage.getItem(DISTANCE_UNIT_KEY);
    return DISTANCE_UNITS.includes(raw) ? raw : DEFAULT_DISTANCE_UNIT;
  } catch {
    return DEFAULT_DISTANCE_UNIT;
  }
}

/**
 * @param {Storage} [storage]
 * @returns {"both"|"c"|"f"}
 */
export function loadTempUnit(storage = safeLocalStorage()) {
  if (!storage) return DEFAULT_TEMP_UNIT;
  try {
    const raw = storage.getItem(TEMP_UNIT_KEY);
    return TEMP_UNITS.includes(raw) ? raw : DEFAULT_TEMP_UNIT;
  } catch {
    return DEFAULT_TEMP_UNIT;
  }
}

/**
 * @param {Storage} [storage]
 * @returns {"gal"|"l"}
 */
export function loadVolumeUnit(storage = safeLocalStorage()) {
  if (!storage) return DEFAULT_VOLUME_UNIT;
  try {
    const raw = storage.getItem(VOLUME_UNIT_KEY);
    return VOLUME_UNITS.includes(raw) ? raw : DEFAULT_VOLUME_UNIT;
  } catch {
    return DEFAULT_VOLUME_UNIT;
  }
}

export function persistVolumeUnit(unit, storage = safeLocalStorage()) {
  if (!storage || !VOLUME_UNITS.includes(unit)) return;
  try {
    storage.setItem(VOLUME_UNIT_KEY, unit);
  } catch {
    // non-fatal
  }
}

export function persistDistanceUnit(unit, storage = safeLocalStorage()) {
  if (!storage || !DISTANCE_UNITS.includes(unit)) return;
  try {
    storage.setItem(DISTANCE_UNIT_KEY, unit);
  } catch {
    // non-fatal
  }
}

export function persistTempUnit(unit, storage = safeLocalStorage()) {
  if (!storage || !TEMP_UNITS.includes(unit)) return;
  try {
    storage.setItem(TEMP_UNIT_KEY, unit);
  } catch {
    // non-fatal
  }
}

export function broadcastUnitsChanged() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(UNITS_CHANGED_EVENT));
  } catch {
    // non-fatal
  }
}

// ─── Conversion ──────────────────────────────────────────────────────────────

/** @param {number} celsius */
export function celsiusToFahrenheit(celsius) {
  return (celsius * 9) / 5 + 32;
}

/** @param {number} miles */
export function milesToKilometers(miles) {
  return miles * MILES_TO_KM;
}

/** @param {number} liters */
export function litersToGallons(liters) {
  return liters * LITERS_TO_GALLONS;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/**
 * Format a distance held in MILES into the user's chosen unit.
 *
 * Miles is the storage unit throughout the app (`radiusMiles`, `distanceMiles`),
 * so this converts on display only and never round-trips a converted value back
 * into storage.
 *
 * @param {number} miles
 * @param {"mi"|"km"} unit
 * @param {{precision?: number}} [opts] - decimal places; 0 for whole-number
 *   radii like the zone card, 1 (default) for measured distances.
 * @returns {string} e.g. "12.4 mi", "20 km"
 */
export function formatDistance(miles, unit = DEFAULT_DISTANCE_UNIT, { precision = 1 } = {}) {
  const value = toFiniteNumber(miles);
  if (value === null) return "";
  if (unit === "km") return `${milesToKilometers(value).toFixed(precision)} km`;
  return `${value.toFixed(precision)} mi`;
}

/**
 * Format a tank volume held in LITRES into the user's chosen unit.
 *
 * Litres is the storage unit (`volumeLiters`) and stays that way — every write
 * path already converts the gallons a keeper types, so this converts on display
 * only and never writes a converted value back.
 *
 * SAFE OVER THE CAPACITY MATHS, which is why volume was previously left out of
 * Settings. The concern recorded in UnitsSection was that a display-only toggle
 * over a value feeding capacity calculations would "lie about whether a fish
 * fits". It does not, because the calculation layer never reads this preference:
 * stockingGuidance.js and compatibleTanks.js each hold their own
 * LITERS_TO_GALLONS and do their arithmetic in gallons regardless of what is
 * displayed. Species minimums are stored in gallons (`minVolumeGallons`) and
 * compared against a gallons figure derived from litres, entirely independently.
 * This function changes a label, not a comparison.
 *
 * Whole gallons by default: tanks are sold as round numbers ("a 20 gallon"), so
 * "20 gal" is the honest rendering of 76 litres and "20.1 gal" is false
 * precision on a value the keeper typed as 20.
 *
 * @param {number} liters
 * @param {"gal"|"l"} unit
 * @param {{precision?: number, long?: boolean}} [opts]
 * @returns {string} e.g. "20 gal", "76L"
 */
export function formatVolume(liters, unit = DEFAULT_VOLUME_UNIT, { precision = 0, long = false } = {}) {
  const value = toFiniteNumber(liters);
  if (value === null) return "";

  if (unit === "l") {
    // Litres keep no decimals: the stored value is already a rounded integer.
    return long ? `${Math.round(value)} litres` : `${Math.round(value)}L`;
  }

  const gallons = litersToGallons(value);
  const shown = precision === 0 ? Math.round(gallons) : gallons.toFixed(precision);
  return long ? `${shown} gallons` : `${shown} gal`;
}

/**
 * Should a Celsius reading be rendered? True for "c" and "both".
 * @param {"both"|"c"|"f"} unit
 */
export function showCelsius(unit = DEFAULT_TEMP_UNIT) {
  return unit === "c" || unit === "both";
}

/**
 * Should a Fahrenheit reading be rendered? True for "f" and "both".
 * @param {"both"|"c"|"f"} unit
 */
export function showFahrenheit(unit = DEFAULT_TEMP_UNIT) {
  return unit === "f" || unit === "both";
}

/**
 * Convenience single-string temperature formatter, for call sites that don't
 * style the two readings separately.
 *
 * `parenthesizeSecond` exists so the two existing call sites can each keep the
 * exact string they rendered before this preference existed — ActivityLog used
 * `24.5°C (76.1°F)`, the TankList telemetry tile used a slash. Reproducing both
 * byte-for-byte is what makes the "both" default a no-op rather than a visual
 * change nobody asked for. It only applies when both readings are shown; with a
 * single unit selected there is no second value to wrap.
 *
 * @param {number} celsius
 * @param {"both"|"c"|"f"} unit
 * @param {{separator?: string, precision?: number, parenthesizeSecond?: boolean}} [opts]
 * @returns {string} e.g. "24.5°C", "76.1°F", "24.5°C / 76.1°F", "24.5°C (76.1°F)"
 */
export function formatTemperature(
  celsius,
  unit = DEFAULT_TEMP_UNIT,
  { separator = " / ", precision = 1, parenthesizeSecond = false } = {}
) {
  const value = toFiniteNumber(celsius);
  if (value === null) return "";
  const parts = [];
  if (showCelsius(unit)) parts.push(`${value.toFixed(precision)}°C`);
  if (showFahrenheit(unit)) parts.push(`${celsiusToFahrenheit(value).toFixed(precision)}°F`);
  if (parts.length === 2 && parenthesizeSecond) {
    return `${parts[0]} (${parts[1]})`;
  }
  return parts.join(separator);
}

/** Human labels for the Settings controls. */
export const DISTANCE_UNIT_LABELS = Object.freeze({
  mi: "Miles",
  km: "Kilometres",
});

export const TEMP_UNIT_LABELS = Object.freeze({
  both: "Both",
  c: "Celsius only",
  f: "Fahrenheit only",
});

export const VOLUME_UNIT_LABELS = Object.freeze({
  gal: "Gallons",
  l: "Litres",
});
