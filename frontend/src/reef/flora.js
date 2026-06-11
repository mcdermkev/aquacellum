/**
 * flora — distinguishes aquatic plants from fish so the reef can root plants on
 * the substrate (swaying) instead of letting them "swim" as billboards.
 *
 * The catalog mixes plants (anubias, vallisneria, cryptocoryne, …) in with the
 * fish. Plant photos are leafy/full-frame, so as swimming sprites they read as
 * floating rectangles. Rendering them as planted, floor-anchored flora fixes
 * that and adds depth to the scene.
 */

// Genus prefixes for common aquarium plants (slug = scientific name, lowercased,
// dashed). Matched as a prefix so e.g. "anubias-barteri-var-nana" is covered.
const PLANT_GENERA = [
  "anubias", "echinodorus", "cryptocoryne", "microsorum", "vallisneria",
  "hygrophila", "rotala", "ludwigia", "bucephalandra", "sagittaria",
  "eleocharis", "bacopa", "cabomba", "elodea", "egeria", "ceratophyllum",
  "limnophila", "pogostemon", "staurogyne", "marsilea", "hemianthus",
  "monosolenium", "riccia", "nymphaea", "aponogeton", "najas", "utricularia",
  "lilaeopsis", "helanthium", "lobelia", "myriophyllum", "taxiphyllum",
  "vesicularia", "fissidens", "salvinia", "pistia", "lemna", "hydrocotyle",
  "alternanthera", "barclaya", "crinum", "nuphar",
];

/** True if a species slug looks like an aquatic plant. */
export function isPlant(slug) {
  if (!slug) return false;
  return PLANT_GENERA.some((g) => slug === g || slug.startsWith(g + "-"));
}
