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

/** Tank type options for registration/edit forms */
export const TANK_TYPES = ["Freshwater", "Saltwater", "Brackish", "Pond"];

/** Containment type options */
export const CONTAINMENT_TYPES = ["Tank", "Tub", "Basket"];
