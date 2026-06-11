/**
 * Hero species — the top 15 fish you'll see in most home aquariums.
 *
 * These have been re-generated with TripoSR `--bake-texture`, so they carry a
 * real UV texture atlas (PBR-ready) and look good as full 3D GLB models.
 * Everything else still falls back to billboard sprites in the reef.
 *
 * Keep this list in sync with HERO_SPECIES in
 * frontend/scripts/trellis_generate.py
 */
export const HERO_SPECIES = [
  { slug: "betta-splendens", common: "Betta" },
  { slug: "paracheirodon-innesi", common: "Neon Tetra" },
  { slug: "paracheirodon-axelrodi", common: "Cardinal Tetra" },
  { slug: "poecilia-reticulata", common: "Guppy" },
  { slug: "poecilia-sphenops", common: "Molly" },
  { slug: "xiphophorus-maculatus", common: "Platy" },
  { slug: "xiphophorus-hellerii", common: "Swordtail" },
  { slug: "danio-rerio", common: "Zebra Danio" },
  { slug: "corydoras-aeneus", common: "Bronze Cory" },
  { slug: "ancistrus-cirrhosus", common: "Bristlenose Pleco" },
  { slug: "pterophyllum-scalare", common: "Angelfish" },
  { slug: "puntigrus-tetrazona", common: "Tiger Barb" },
  { slug: "trigonostigma-heteromorpha", common: "Harlequin Rasbora" },
  { slug: "trichogaster-lalius", common: "Dwarf Gourami" },
  { slug: "mikrogeophagus-ramirezi", common: "German Blue Ram" },
];

/** Fast lookup set of hero slugs (these have high-quality textured GLBs). */
export const HERO_SLUGS = new Set(HERO_SPECIES.map((s) => s.slug));

/** True if a species slug has a baked-texture hero GLB worth rendering in 3D. */
export function isHeroSpecies(slug) {
  return HERO_SLUGS.has(slug);
}
