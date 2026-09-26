/**
 * tankUtils.js — Pure utility functions extracted from TankList.jsx
 * 
 * These are stateless helpers used for tank display, parameter validation,
 * and image URL generation.
 */

/**
 * Check if a parameter value falls within the safe envelope.
 */
export function isInsideEnvelope(val, safeMin, safeMax) {
  return val >= safeMin && val <= safeMax;
}

/**
 * Generate a CSS gradient background for a parameter slider track,
 * showing safe (green) vs danger (red) zones.
 */
export function getTrackBackground(minVal, maxVal, safeMin, safeMax) {
  if (safeMin === undefined || safeMax === undefined) {
    return "rgba(255,255,255,0.1)";
  }
  const pctMin = ((safeMin - minVal) / (maxVal - minVal)) * 100;
  const pctMax = ((safeMax - minVal) / (maxVal - minVal)) * 100;
  return `linear-gradient(to right, rgba(239, 68, 68, 0.45) 0%, rgba(239, 68, 68, 0.45) ${pctMin}%, rgba(34, 197, 94, 0.65) ${pctMin}%, rgba(34, 197, 94, 0.65) ${pctMax}%, rgba(239, 68, 68, 0.45) ${pctMax}%, rgba(239, 68, 68, 0.45) 100%)`;
}

// ─── Tank types (saltwater removed) ─────────────────────────────────────────
// Aquacellum is freshwater-focused; saltwater is not offered anywhere in the
// product. Index positions are FIXED to stay aligned with the deployed on-chain
// `TankType` enum ({Freshwater, Saltwater, Brackish, Pond} = 0,1,2,3) and with
// any existing stored records. Index 1 is therefore RESERVED (never selectable,
// never created) rather than removed from the numbering: the Dexie v23 migration
// converts any legacy `tankType === 1` record to Freshwater (0), and the
// positional label array below maps 1 → "Freshwater" so nothing ever renders as
// saltwater even if a stray record slips through.

/** Canonical selectable tank types (id matches the on-chain enum index). */
export const TANK_TYPE_OPTIONS = [
  { id: 0, label: "Freshwater", icon: "💧" },
  { id: 2, label: "Brackish", icon: "🌿" },
  { id: 3, label: "Pond", icon: "🏞️" },
];

/**
 * Back-compat positional label lookup by tankType index. Index 1 (legacy
 * saltwater) is repointed to "Freshwater" so removed saltwater never surfaces.
 */
export const TANK_TYPES = ["Freshwater", "Freshwater", "Brackish", "Pond"];

/** Human label for a tankType index (saltwater-safe). */
export function tankTypeLabel(tankType) {
  return TANK_TYPES[Number(tankType) || 0] || "Freshwater";
}

/** Emoji icon for a tankType index (saltwater-safe). */
export function tankTypeIcon(tankType) {
  const found = TANK_TYPE_OPTIONS.find((o) => o.id === (Number(tankType) || 0));
  return found ? found.icon : "💧";
}

/** Containment type options */
export const CONTAINMENT_TYPES = ["Tank", "Tub", "Basket"];

// ─── Water parameter envelopes (single source of truth) ─────────────────────
// Replaces the inline per-type if/else safe ranges and the copy-pasted nitrogen
// thresholds (0.05 / 0.05 / 20) that were duplicated across the card, the
// overview tiles, and getChemistryAlerts. Every safe-range and alert decision
// should read from here so there is exactly one place to tune husbandry limits.

/** Nitrogen-cycle safety limits (ppm). Universal across freshwater tank types. */
export const NITROGEN_LIMITS = { ammoniaMax: 0.05, nitriteMax: 0.05, nitrateMax: 20.0 };

// ─── Hardness & alkalinity ideal ranges ─────────────────────────────────────
// GH (general hardness) and KH (carbonate hardness) are reported in degrees
// (dGH / dKH); TAL (total alkalinity) in ppm as CaCO₃. These round out the
// most commonly-tested freshwater traits alongside temp/pH/nitrogen. Ranges are
// carried per tankType in WATER_ENVELOPES below so brackish/pond can differ.

/** Temp (°C), pH, hardness (dGH/dKH) and alkalinity (ppm) safe ranges by
 *  tankType index. Index 1 falls back to FW. */
const WATER_ENVELOPES = {
  // Freshwater
  0: { tempMin: 22.0, tempMax: 26.0, phMin: 6.5, phMax: 7.8, ghMin: 4.0, ghMax: 12.0, khMin: 3.0, khMax: 8.0, talMin: 50.0, talMax: 140.0 },
  // Brackish
  2: { tempMin: 22.0, tempMax: 28.0, phMin: 7.2, phMax: 8.2, ghMin: 12.0, ghMax: 20.0, khMin: 8.0, khMax: 15.0, talMin: 140.0, talMax: 260.0 },
  // Pond
  3: { tempMin: 10.0, tempMax: 28.0, phMin: 6.8, phMax: 8.0, ghMin: 5.0, ghMax: 15.0, khMin: 4.0, khMax: 10.0, talMin: 70.0, talMax: 180.0 },
};

/**
 * Full safe envelope for a tankType: temp/pH ranges + hardness/alkalinity
 * ranges + nitrogen limits. Unknown or reserved indices (incl. legacy
 * saltwater = 1) fall back to the Freshwater envelope.
 * @param {number} tankType
 * @returns {{tempMin:number,tempMax:number,phMin:number,phMax:number,ghMin:number,ghMax:number,khMin:number,khMax:number,talMin:number,talMax:number,ammoniaMax:number,nitriteMax:number,nitrateMax:number}}
 */
export function getWaterEnvelope(tankType) {
  const base = WATER_ENVELOPES[Number(tankType)] || WATER_ENVELOPES[0];
  return { ...base, ...NITROGEN_LIMITS };
}

/**
 * Evaluate a normalized reading against a tank's envelope.
 * @param {number} tankType
 * @param {{temp?:number, ph?:number, ammonia?:number, nitrite?:number, nitrate?:number, gh?:number, kh?:number, tal?:number}} r
 * @returns {{flags:string[], tempOk:boolean, phOk:boolean, ammoniaOk:boolean, nitriteOk:boolean, nitrateOk:boolean, ghOk:boolean, khOk:boolean, talOk:boolean}}
 */
export function evaluateReading(tankType, r = {}) {
  const env = getWaterEnvelope(tankType);
  const flags = [];
  const has = (v) => v !== undefined && v !== null && !Number.isNaN(Number(v));

  const tempOk = !has(r.temp) || isInsideEnvelope(Number(r.temp), env.tempMin, env.tempMax);
  const phOk = !has(r.ph) || isInsideEnvelope(Number(r.ph), env.phMin, env.phMax);
  const ammoniaOk = !has(r.ammonia) || Number(r.ammonia) <= env.ammoniaMax;
  const nitriteOk = !has(r.nitrite) || Number(r.nitrite) <= env.nitriteMax;
  const nitrateOk = !has(r.nitrate) || Number(r.nitrate) <= env.nitrateMax;
  const ghOk = !has(r.gh) || isInsideEnvelope(Number(r.gh), env.ghMin, env.ghMax);
  const khOk = !has(r.kh) || isInsideEnvelope(Number(r.kh), env.khMin, env.khMax);
  const talOk = !has(r.tal) || isInsideEnvelope(Number(r.tal), env.talMin, env.talMax);

  if (!tempOk) flags.push(`Temp ${Number(r.temp).toFixed(1)}°C outside ${env.tempMin}–${env.tempMax}°C`);
  if (!phOk) flags.push(`pH ${Number(r.ph).toFixed(1)} outside ${env.phMin}–${env.phMax}`);
  if (!ammoniaOk) flags.push(`High ammonia (${Number(r.ammonia).toFixed(2)} ppm)`);
  if (!nitriteOk) flags.push(`High nitrite (${Number(r.nitrite).toFixed(2)} ppm)`);
  if (!nitrateOk) flags.push(`High nitrate (${Number(r.nitrate).toFixed(1)} ppm)`);
  if (!ghOk) flags.push(`GH ${Number(r.gh).toFixed(1)} dGH outside ${env.ghMin}–${env.ghMax}`);
  if (!khOk) flags.push(`KH ${Number(r.kh).toFixed(1)} dKH outside ${env.khMin}–${env.khMax}`);
  if (!talOk) flags.push(`Alkalinity ${Number(r.tal).toFixed(0)} ppm outside ${env.talMin}–${env.talMax}`);

  return { flags, tempOk, phOk, ammoniaOk, nitriteOk, nitrateOk, ghOk, khOk, talOk };
}
