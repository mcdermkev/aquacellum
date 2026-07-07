/**
 * generateAlias.js
 * 
 * Generates a deterministic, fish-themed friendly alias from a wallet address.
 * The alias is human-readable and consistent — the same address always produces
 * the same alias. Format: "adjective-fish-nnnn" (e.g., "coral-tetra-4821")
 *
 * Output is always lowercase so the app never introduces mixed-casing into
 * identifiers (matches our canonical lowercase policy).
 *
 * Used in casual mode to replace hex addresses with friendly identifiers.
 */

const ADJECTIVES = [
  "Coral", "Sapphire", "Drift", "Lunar", "Ember",
  "Misty", "Crystal", "Tide", "Storm", "Solar",
  "Velvet", "Copper", "Silver", "Frost", "Dusk",
  "Reef", "Azure", "Pearl", "Golden", "Moss",
  "Jade", "Cobalt", "Crimson", "Opal", "Indigo",
  "Rustic", "Aqua", "Tidal", "Brine", "Prism",
  "Starlit", "Sunken", "Deep", "Calm", "Wild",
];

const FISH_NAMES = [
  "Tetra", "Guppy", "Betta", "Pleco", "Rasbora",
  "Danio", "Cory", "Molly", "Barb", "Loach",
  "Killi", "Goby", "Wrasse", "Tang", "Angel",
  "Discus", "Oscar", "Arowana", "Pike", "Darter",
  "Minnow", "Shiner", "Blenny", "Gudgeon", "Cichlid",
  "Snapper", "Grouper", "Bass", "Perch", "Sculpin",
];

/**
 * Generate a deterministic friendly alias from a wallet address.
 * @param {string} address - Ethereum wallet address (0x...)
 * @returns {string} Friendly alias like "Coral-Tetra-4821"
 */
export function generateAlias(address) {
  if (!address || address.length < 10) {
    return "unknown-fish-0000";
  }

  // Use different slices of the hex address for each component
  const normalized = address.toLowerCase().replace("0x", "");

  // Bytes 0-3 → adjective index
  const adjIndex = parseInt(normalized.slice(0, 4), 16) % ADJECTIVES.length;

  // Bytes 4-7 → fish name index
  const fishIndex = parseInt(normalized.slice(4, 8), 16) % FISH_NAMES.length;

  // Bytes 8-11 → 4-digit numeric suffix
  const numSuffix = (parseInt(normalized.slice(8, 12), 16) % 9000) + 1000;

  return `${ADJECTIVES[adjIndex]}-${FISH_NAMES[fishIndex]}-${numSuffix}`.toLowerCase();
}
