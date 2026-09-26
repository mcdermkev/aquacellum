// Medaka Morph Guide — reference content.
//
// A plain-language reference for the medaka (Japanese rice fish, Oryzias latipes)
// morphs shown on the breeder showcases. This is deliberately honest: each entry
// is a keeper's description plus accurate, general medaka facts. It does NOT
// assert verified genetics, lineage, or trait heritability — where a claim is a
// naming/appearance description rather than an established fact, it reads that way.
//
// Photos reuse the same static assets served for the showcase, so there is no
// second media pipeline. The guide grows by adding entries here.

export const MEDAKA_SPECIES = {
  commonName: "Japanese rice fish",
  scientificName: "Oryzias latipes",
  // Species detail page resolves by slug = toSlug(scientificName).
  href: "/species/oryzias-latipes",
};

export const MEDAKA_MORPHS = [
  {
    slug: "pink-saffire",
    name: "Pink Saffire",
    breeder: "Steve",
    photo: "/showcase-media/steve/lines/pink-saffire/IMG_20260907_165711_303.jpg",
    alt: "Pink Saffire medaka — soft pink/lavender body with blue eyes",
    productPath: "/app/products/batch-8000001",
    traits: [
      { label: "Color", value: "Pink / lavender" },
      { label: "Eyes", value: "Blue" },
    ],
    description:
      "A soft pink-to-lavender medaka with striking blue eyes — one of Steve's signature color lines. The colour reads pastel in daylight and deepens under warmer lighting.",
  },
  {
    slug: "echos-of-the-moon",
    name: "Echos of the Moon",
    breeder: "Steve",
    photo: "/showcase-media/steve/lines/echos-of-the-moon/IMG_20260907_171300_216.jpg",
    alt: "Echos of the Moon medaka line",
    productPath: "/app/products/batch-8000003",
    traits: [
      { label: "Type", value: "Keeper line" },
    ],
    description:
      "One of Steve's named medaka lines, kept in the planted moon-pond display. Presented here as the breeder keeps and names it rather than as a standardised variety.",
  },
  {
    slug: "gladio",
    name: "Gladio",
    breeder: "Steve",
    photo: "/showcase-media/steve/lines/gladio/IMG_20260907_170316_911.jpg",
    alt: "Gladio medaka — silvery-white with long flowing fins",
    productPath: "/app/products/batch-8000002",
    traits: [
      { label: "Color", value: "Silvery-white" },
      { label: "Fins", value: "Long-fin" },
    ],
    description:
      "A silvery-white medaka carrying the long-fin trait, so the fins trail and flow as it swims. Best appreciated from the side in a planted tank where the fins catch the light.",
  },
  {
    slug: "shinkai",
    name: "Shinkai",
    breeder: "Steve",
    photo: "/showcase-media/steve/lines/shinkai/IMG_20260907_171554_047.jpg",
    alt: "Shinkai medaka — silvery, translucent",
    productPath: "/app/products/batch-8000004",
    traits: [
      { label: "Color", value: "Silvery / translucent" },
    ],
    description:
      "A silvery, translucent line kept as a small school. \u201CShinkai\u201D means \u201Cdeep sea\u201D in Japanese, which suits the cool, glassy look of the fish in a darker tank.",
  },
  {
    slug: "long-fin-red-emperor",
    name: "Long Fin Red Emperor",
    breeder: "Steve",
    photo: "/showcase-media/steve/posters/VID_20260901_115510_665.jpg",
    alt: "Long Fin Red Emperor medaka — orange/crimson with a dark tail",
    productPath: "/app/products/batch-8000005",
    traits: [
      { label: "Color", value: "Orange / crimson" },
      { label: "Fins", value: "Long-fin" },
    ],
    description:
      "A bold orange-to-crimson medaka with the long-fin trait and a darker tail. A high-contrast fish that stands out in an outdoor tub under natural light.",
  },
  {
    slug: "blue-aurora-lame",
    name: "Blue Aurora Lam\u00e9",
    breeder: "Steve",
    photo: "/showcase-media/steve/posters/VID_20260901_115521_576.jpg",
    alt: "Blue Aurora Lam\u00e9 medaka — electric blue with metallic shimmer",
    productPath: "/app/products/batch-8000006",
    traits: [
      { label: "Color", value: "Electric blue" },
      { label: "Scales", value: "Lam\u00e9 (metallic)" },
    ],
    description:
      "Vivid electric-blue fish with the \u201Clam\u00e9\u201D trait — a metallic, reflective shimmer along the back that flashes as they turn. Shown here as growing juveniles.",
  },
];

export function medakaMorphBySlug(slug) {
  return MEDAKA_MORPHS.find((morph) => morph.slug === slug) || null;
}
