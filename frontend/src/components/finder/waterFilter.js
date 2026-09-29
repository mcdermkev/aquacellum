/**
 * waterFilter.js — freshwater / saltwater in Fish Finder (docs/SALTWATER_SPEC.md).
 * Pure; no React.
 */

import { catalogWaterGroup } from "../../services/speciesCatalog.js";

export const WATER_FILTERS = Object.freeze([
  { id: "all", label: "All", icon: "🌊" },
  { id: "freshwater", label: "Freshwater", icon: "💧" },
  { id: "marine", label: "Saltwater", icon: "🐠" },
]);

const nameKey = (e) => String(e?.scientificName || "").toLowerCase();

/**
 * The on-chain catalog only holds species the curator has registered, which
 * so far are all freshwater. Marine species from the curated catalog are added
 * after it, so they're findable before they're registered on chain.
 */
export function withMarineGlobals(contractEntries = [], globalEntries = []) {
  if (!Array.isArray(contractEntries) || contractEntries.length === 0) return globalEntries;
  const have = new Set(contractEntries.map(nameKey));
  const extra = (globalEntries || []).filter((g) => g?.waterGroup === "marine" && !have.has(nameKey(g)));
  return extra.length ? [...contractEntries, ...extra] : contractEntries;
}

/** "freshwater" | "marine" for any entry: its own tag, else the curated record's. */
export function entryWaterGroup(entry, fishbaseByName) {
  if (entry?.waterGroup) return entry.waterGroup;
  const master = fishbaseByName?.get(nameKey(entry));
  return master ? catalogWaterGroup(master) : "freshwater";
}

export function filterByWater(entries = [], water = "all", fishbaseData = []) {
  if (water === "all") return entries;
  const byName = new Map((fishbaseData || []).map((r) => [nameKey(r), r]));
  return entries.filter((e) => entryWaterGroup(e, byName) === water);
}
