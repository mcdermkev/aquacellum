/**
 * speciesSections.js
 *
 * Canonical section vocabulary for species-page content routing.
 * Used by the Reef Composer section picker and the species detail page
 * to classify and route user-generated content (Currents & Insights)
 * into the correct section automatically.
 *
 * Colors are hex (not CSS vars) because consumers append hex alpha (e.g. ${color}18);
 * they are the text-safe (>=4.5:1 on white) shades for the light theme.
 */

export const SPECIES_SECTIONS = [
  { id: "feeding", label: "Feeding", icon: "🍽️", color: "#b45309", description: "Diet tips, food recommendations, feeding schedules" },
  { id: "setup", label: "Tank Setup", icon: "🏠", color: "#0369a1", description: "Equipment, layout, substrate, decor" },
  { id: "health", label: "Health", icon: "🩺", color: "#b91c1c", description: "Disease prevention, treatment, quarantine" },
  { id: "breeding", label: "Breeding", icon: "🧬", color: "#047857", description: "Spawning conditions, fry care, genetics" },
  { id: "tankmates", label: "Tankmates", icon: "🐟", color: "#7e22ce", description: "Compatibility, stocking ideas, conflicts" },
  { id: "behavior", label: "Behavior", icon: "👁️", color: "#c2410c", description: "Activity patterns, aggression, enrichment" },
  { id: "water", label: "Water Params", icon: "🌡️", color: "#0e7490", description: "pH, temperature, hardness, cycling" },
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
