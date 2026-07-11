/**
 * speciesSections.js
 *
 * Canonical section vocabulary for species-page content routing.
 * Used by the Reef Composer section picker and the species detail page
 * to classify and route user-generated content (Currents & Insights)
 * into the correct section automatically.
 */

export const SPECIES_SECTIONS = [
  { id: "feeding", label: "Feeding", icon: "🍽️", color: "#fbbf24", description: "Diet tips, food recommendations, feeding schedules" },
  { id: "setup", label: "Tank Setup", icon: "🏠", color: "#38bdf8", description: "Equipment, layout, substrate, decor" },
  { id: "health", label: "Health", icon: "🩺", color: "#f87171", description: "Disease prevention, treatment, quarantine" },
  { id: "breeding", label: "Breeding", icon: "🧬", color: "#34d399", description: "Spawning conditions, fry care, genetics" },
  { id: "tankmates", label: "Tankmates", icon: "🐟", color: "#a855f7", description: "Compatibility, stocking ideas, conflicts" },
  { id: "behavior", label: "Behavior", icon: "👁️", color: "#fb923c", description: "Activity patterns, aggression, enrichment" },
  { id: "water", label: "Water Params", icon: "🌡️", color: "#06b6d4", description: "pH, temperature, hardness, cycling" },
];

/**
 * Lookup a section by ID.
 * @param {string} id - Section ID (e.g. "feeding")
 * @returns {Object|undefined}
 */
export function getSectionById(id) {
  return SPECIES_SECTIONS.find((s) => s.id === id);
}

/**
 * Default section when none is explicitly chosen.
 */
export const DEFAULT_SECTION = null;
