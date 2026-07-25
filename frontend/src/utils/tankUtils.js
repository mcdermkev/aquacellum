/**
 * tankUtils.js — Pure utility functions extracted from TankList.jsx
 * 
 * These are stateless helpers used for tank display, parameter validation,
 * and image URL generation.
 */

/**
 * Generate a Supabase Storage image URL for a tank's primary species.
 * Falls back through inhabitants → species → tank name.
 */
export function getSupabaseImageUrl(activeTank) {
  if (!activeTank) return "";
  
  const targetName = 
    (activeTank.inhabitants && activeTank.inhabitants[0] && activeTank.inhabitants[0].commonName) || 
    activeTank.species || 
    activeTank.name || 
    "";

  const formatted = targetName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `https://oexctbbybpfvslgxlscg.supabase.co/storage/v1/object/public/fish-photos/${formatted}.jpg?width=300&height=300&resize=contain&quality=80`;
}

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

/** Temp (°C) and pH safe ranges by tankType index. Index 1 falls back to FW. */
const WATER_ENVELOPES = {
  0: { tempMin: 22.0, tempMax: 26.0, phMin: 6.5, phMax: 7.8 }, // Freshwater
  2: { tempMin: 22.0, tempMax: 28.0, phMin: 7.2, phMax: 8.2 }, // Brackish
  3: { tempMin: 10.0, tempMax: 28.0, phMin: 6.8, phMax: 8.0 }, // Pond
};

/**
 * Full safe envelope for a tankType: temp/pH ranges + nitrogen limits.
 * Unknown or reserved indices (incl. legacy saltwater = 1) fall back to
 * the Freshwater envelope.
 * @param {number} tankType
 * @returns {{tempMin:number,tempMax:number,phMin:number,phMax:number,ammoniaMax:number,nitriteMax:number,nitrateMax:number}}
 */
export function getWaterEnvelope(tankType) {
  const base = WATER_ENVELOPES[Number(tankType)] || WATER_ENVELOPES[0];
  return { ...base, ...NITROGEN_LIMITS };
}

/**
 * Evaluate a normalized reading against a tank's envelope.
 * @param {number} tankType
 * @param {{temp?:number, ph?:number, ammonia?:number, nitrite?:number, nitrate?:number}} r
 * @returns {{flags:string[], tempOk:boolean, phOk:boolean, ammoniaOk:boolean, nitriteOk:boolean, nitrateOk:boolean}}
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

  if (!tempOk) flags.push(`Temp ${Number(r.temp).toFixed(1)}°C outside ${env.tempMin}–${env.tempMax}°C`);
  if (!phOk) flags.push(`pH ${Number(r.ph).toFixed(1)} outside ${env.phMin}–${env.phMax}`);
  if (!ammoniaOk) flags.push(`High ammonia (${Number(r.ammonia).toFixed(2)} ppm)`);
  if (!nitriteOk) flags.push(`High nitrite (${Number(r.nitrite).toFixed(2)} ppm)`);
  if (!nitrateOk) flags.push(`High nitrate (${Number(r.nitrate).toFixed(1)} ppm)`);

  return { flags, tempOk, phOk, ammoniaOk, nitriteOk, nitrateOk };
}
