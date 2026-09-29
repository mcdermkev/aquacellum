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


// ─── Tank types ─────────────────────────────────────────────────────────────
// Index positions are FIXED to the deployed on-chain `TankType` enum
// ({Freshwater, Saltwater, Brackish, Pond} = 0,1,2,3) and to stored records.
//
// Saltwater (1) was retired in 2026-06 and is offered again from 2026-09-30
// (docs/SALTWATER_SPEC.md). The Dexie v23 upgrade remapped legacy 1 → 0 once,
// for people upgrading from before v23; it doesn't run for anyone on v23+, so
// new saltwater tanks keep their type.

/** Canonical selectable tank types (id matches the on-chain enum index). */
export const TANK_TYPE_OPTIONS = [
  { id: 0, label: "Freshwater", icon: "💧" },
  { id: 1, label: "Saltwater", icon: "🐠" },
  { id: 2, label: "Brackish", icon: "🌿" },
  { id: 3, label: "Pond", icon: "🏞️" },
];

export const SALTWATER = 1;

/** Positional label lookup by tankType index. */
export const TANK_TYPES = ["Freshwater", "Saltwater", "Brackish", "Pond"];

/** Human label for a tankType index. */
export function tankTypeLabel(tankType) {
  return TANK_TYPES[Number(tankType) || 0] || "Freshwater";
}

/** Emoji icon for a tankType index. */
export function tankTypeIcon(tankType) {
  const found = TANK_TYPE_OPTIONS.find((o) => o.id === (Number(tankType) || 0));
  return found ? found.icon : "💧";
}

/** True for a marine (saltwater/reef) tank. */
export function isSaltwaterTank(tankOrType) {
  const t = tankOrType && typeof tankOrType === "object" ? tankOrType.tankType : tankOrType;
  return Number(t) === SALTWATER;
}

/** Containment type options */
export const CONTAINMENT_TYPES = ["Tank", "Tub", "Basket"];

// ─── Water parameter envelopes (single source of truth) ─────────────────────
// Every safe-range and alert decision reads from here, so there is exactly one
// place to tune husbandry limits. A null bound means "not checked for this
// water type" (e.g. GH on a reef, salinity in freshwater).

/** Nitrogen-cycle safety limits (ppm). The same across water types. */
export const NITROGEN_LIMITS = { ammoniaMax: 0.05, nitriteMax: 0.05, nitrateMax: 20.0 };

const NO_MARINE = { salinityMin: null, salinityMax: null, caMin: null, caMax: null, mgMin: null, mgMax: null, po4Max: null };

/**
 * Temp (°C), pH, hardness (dGH/dKH), alkalinity (ppm CaCO₃), and for saltwater
 * salinity (specific gravity), calcium, magnesium (ppm) and phosphate (ppm).
 */
const WATER_ENVELOPES = {
  // Freshwater
  0: { tempMin: 22.0, tempMax: 26.0, phMin: 6.5, phMax: 7.8, ghMin: 4.0, ghMax: 12.0, khMin: 3.0, khMax: 8.0, talMin: 50.0, talMax: 140.0, ...NO_MARINE },
  // Saltwater (fish and reef). Reef-keeping targets; a fish-only tank that
  // tests Ca/Mg/PO4 is well served by them too. GH isn't a marine measure.
  1: {
    tempMin: 24.0, tempMax: 27.0, phMin: 7.9, phMax: 8.5, ghMin: null, ghMax: null,
    khMin: 7.0, khMax: 12.0, talMin: 125.0, talMax: 215.0,
    salinityMin: 1.023, salinityMax: 1.026, caMin: 380, caMax: 450, mgMin: 1250, mgMax: 1400, po4Max: 0.1,
  },
  // Brackish
  2: { tempMin: 22.0, tempMax: 28.0, phMin: 7.2, phMax: 8.2, ghMin: 12.0, ghMax: 20.0, khMin: 8.0, khMax: 15.0, talMin: 140.0, talMax: 260.0, ...NO_MARINE },
  // Pond
  3: { tempMin: 10.0, tempMax: 28.0, phMin: 6.8, phMax: 8.0, ghMin: 5.0, ghMax: 15.0, khMin: 4.0, khMax: 10.0, talMin: 70.0, talMax: 180.0, ...NO_MARINE },
};

/**
 * Full safe envelope for a tankType. Unknown indices fall back to Freshwater.
 * @param {number} tankType
 */
export function getWaterEnvelope(tankType) {
  const base = WATER_ENVELOPES[Number(tankType)] || WATER_ENVELOPES[0];
  return { ...base, ...NITROGEN_LIMITS };
}

/** Which test fields a water-test form should offer for a tank type. */
export function waterTestFields(tankType) {
  return isSaltwaterTank(tankType)
    ? ["temp", "ph", "salinity", "ammonia", "nitrite", "nitrate", "kh", "ca", "mg", "po4"]
    : ["temp", "ph", "ammonia", "nitrite", "nitrate", "gh", "kh", "tal"];
}

/**
 * Evaluate a normalized reading against a tank's envelope. A bound of null is
 * skipped, so a freshwater reading is never judged on salinity and a reef is
 * never judged on GH.
 * @param {number} tankType
 * @param {{temp?:number, ph?:number, ammonia?:number, nitrite?:number, nitrate?:number, gh?:number, kh?:number, tal?:number, salinity?:number, ca?:number, mg?:number, po4?:number}} r
 */
export function evaluateReading(tankType, r = {}) {
  const env = getWaterEnvelope(tankType);
  const flags = [];
  const has = (v) => v !== undefined && v !== null && v !== "" && !Number.isNaN(Number(v));
  const within = (v, min, max) => !has(v) || min == null || max == null || isInsideEnvelope(Number(v), min, max);
  const atMost = (v, max) => !has(v) || max == null || Number(v) <= max;

  const tempOk = within(r.temp, env.tempMin, env.tempMax);
  const phOk = within(r.ph, env.phMin, env.phMax);
  const ammoniaOk = atMost(r.ammonia, env.ammoniaMax);
  const nitriteOk = atMost(r.nitrite, env.nitriteMax);
  const nitrateOk = atMost(r.nitrate, env.nitrateMax);
  const ghOk = within(r.gh, env.ghMin, env.ghMax);
  const khOk = within(r.kh, env.khMin, env.khMax);
  const talOk = within(r.tal, env.talMin, env.talMax);
  const salinityOk = within(r.salinity, env.salinityMin, env.salinityMax);
  const caOk = within(r.ca, env.caMin, env.caMax);
  const mgOk = within(r.mg, env.mgMin, env.mgMax);
  const po4Ok = atMost(r.po4, env.po4Max);

  if (!tempOk) flags.push(`Temp ${Number(r.temp).toFixed(1)}°C outside ${env.tempMin}–${env.tempMax}°C`);
  if (!phOk) flags.push(`pH ${Number(r.ph).toFixed(1)} outside ${env.phMin}–${env.phMax}`);
  if (!ammoniaOk) flags.push(`High ammonia (${Number(r.ammonia).toFixed(2)} ppm)`);
  if (!nitriteOk) flags.push(`High nitrite (${Number(r.nitrite).toFixed(2)} ppm)`);
  if (!nitrateOk) flags.push(`High nitrate (${Number(r.nitrate).toFixed(1)} ppm)`);
  if (!ghOk) flags.push(`GH ${Number(r.gh).toFixed(1)} dGH outside ${env.ghMin}–${env.ghMax}`);
  if (!khOk) flags.push(`KH ${Number(r.kh).toFixed(1)} dKH outside ${env.khMin}–${env.khMax}`);
  if (!talOk) flags.push(`Alkalinity ${Number(r.tal).toFixed(0)} ppm outside ${env.talMin}–${env.talMax}`);
  if (!salinityOk) flags.push(`Salinity ${Number(r.salinity).toFixed(3)} SG outside ${env.salinityMin}–${env.salinityMax}`);
  if (!caOk) flags.push(`Calcium ${Number(r.ca).toFixed(0)} ppm outside ${env.caMin}–${env.caMax}`);
  if (!mgOk) flags.push(`Magnesium ${Number(r.mg).toFixed(0)} ppm outside ${env.mgMin}–${env.mgMax}`);
  if (!po4Ok) flags.push(`High phosphate (${Number(r.po4).toFixed(2)} ppm)`);

  return { flags, tempOk, phOk, ammoniaOk, nitriteOk, nitrateOk, ghOk, khOk, talOk, salinityOk, caOk, mgOk, po4Ok };
}

/**
 * Saltwater test form values → the stored log fields. Blank or unreadable
 * values are left out (null) rather than saved as 0, so an untested calcium
 * never reads as "0 ppm, far too low".
 *   salinitySgX10000  on-chain slot (1.025 SG → 10250)
 *   caPpm, mgPpm      local, whole ppm
 *   po4PpmX100        local, ppm ×100
 * @param {{salinity?:string|number, ca?:string|number, mg?:string|number, po4?:string|number}} form
 */
export function marineLogFields(form = {}) {
  const n = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : Number(v));
  const sg = n(form.salinity);
  const ca = n(form.ca);
  const mg = n(form.mg);
  const po4 = n(form.po4);
  return {
    salinitySgX10000: sg !== null && sg >= 1.0 && sg <= 1.05 ? Math.round(sg * 10000) : 0,
    caPpm: ca !== null && ca >= 0 && ca <= 1000 ? Math.round(ca) : null,
    mgPpm: mg !== null && mg >= 0 && mg <= 3000 ? Math.round(mg) : null,
    po4PpmX100: po4 !== null && po4 >= 0 && po4 <= 10 ? Math.round(po4 * 100) : null,
  };
}

/**
 * Saltwater form values prefilled from the tank's last log (for "repeat last
 * reading" and opening the test). Returns {} for other water types, so a
 * caller can always spread it in. Alkalinity starts at a reef-typical 8 dKH
 * rather than the freshwater 5 when there's no previous reading.
 */
export function marineFormFromLog(lastLog, tankType) {
  if (!isSaltwaterTank(tankType)) return {};
  const sg = Number(lastLog?.salinitySgX10000);
  return {
    salinity: sg > 10010 && sg <= 10500 ? (sg / 10000).toFixed(3) : "1.025",
    kh: lastLog?.khX10 ? (lastLog.khX10 / 10).toString() : "8.0",
    ca: lastLog?.caPpm != null ? String(lastLog.caPpm) : "",
    mg: lastLog?.mgPpm != null ? String(lastLog.mgPpm) : "",
    po4: lastLog?.po4PpmX100 != null ? (lastLog.po4PpmX100 / 100).toString() : "",
  };
}
