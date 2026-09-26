// Curated, operator-managed showcases.
//
// This is the simple "fish room showcase" path: a keeper's room, curated with
// the photos and videos they sent, served to the standalone /showcase/<slug>
// page with a plain public/private flag. No wallet signing, no identity
// ceremony, no atomic publication — the operator sets it up and flips it public.
//
// The generic wallet/identity-published showcase path (showcase_public_room RPC)
// remains untouched for any slug that is NOT curated here, so this adds a lane
// rather than changing the existing one. Curation is only consulted when
// SHOWCASE_CURATED_ENABLED === "true" so tests and other environments keep the
// original RPC behavior by default.

const MEDIA = "/showcase-media/steve";

const STEVE_ROOM = {
  public: true,
  ownerWallet: "0xef0931458159097a62fddd0ca798f269b5ce98f7",
  room: {
    schemaVersion: 1,
    slug: "ggstevericefishnj",
    title: "GG Steve Rice Fish NJ",
    description:
      "Japanese rice fish (medaka) bred by Steve in New Jersey. A look inside the fish room — the planted show pond, the outdoor breeding tubs, and the lines he is working.",
    hero: {
      image: `${MEDIA}/hero/show-pond-flag.jpg`,
      alt: "Steve's planted medaka show pond",
      focalPoint: { x: 0.5, y: 0.5 },
    },
    actions: [
      { label: "Shop Steve's fish", href: "/store/ggstevericefishnj" },
      { label: "Medaka morph guide", href: "/medaka-morphs" },
      { label: "Browse the marketplace", href: "/marketplace.html" },
    ],
    videos: [
      {
        src: `${MEDIA}/videos/VID_20260901_115511_370.mp4`,
        poster: `${MEDIA}/posters/VID_20260901_115511_370.jpg`,
        title: "The show pond",
        caption: "Planted display with orange, red, and darker medaka moving through the plants.",
        alt: "Planted medaka show pond",
      },
      {
        src: `${MEDIA}/videos/VID_20260901_115451_294.mp4`,
        poster: `${MEDIA}/posters/VID_20260901_115451_294.jpg`,
        title: "Gladio",
        caption: "A silvery-white long-fin medaka drifting through a planted tank.",
        alt: "Silvery-white long-fin medaka",
      },
      {
        src: `${MEDIA}/videos/VID_20260901_115510_666.mp4`,
        poster: `${MEDIA}/posters/VID_20260901_115510_666.jpg`,
        title: "Shinkai",
        caption: "A small school of translucent medaka in a dark tank.",
        alt: "School of translucent medaka",
      },
      {
        src: `${MEDIA}/videos/VID_20260901_115510_665.mp4`,
        poster: `${MEDIA}/posters/VID_20260901_115510_665.jpg`,
        title: "Long Fin Red Emperor",
        caption: "A single orange-crimson medaka with a dark tail in an outdoor tub.",
        alt: "Orange-crimson long-fin medaka",
      },
      {
        src: `${MEDIA}/videos/VID_20260901_115521_576.mp4`,
        poster: `${MEDIA}/posters/VID_20260901_115521_576.jpg`,
        title: "Blue Aurora Lamé",
        caption: "Two vivid electric-blue juveniles against green water.",
        alt: "Electric-blue medaka juveniles",
      },
      {
        src: `${MEDIA}/videos/VID_20260901_115521_154.mp4`,
        poster: `${MEDIA}/posters/VID_20260901_115521_154.jpg`,
        title: "Gold tub",
        caption: "Bright yellow-gold medaka near the surface of a green-water tub.",
        alt: "Yellow-gold medaka in a green-water tub",
      },
    ],
    tanks: [
      {
        slug: "show-pond",
        guideUrl: "/medaka-morphs",
        commerce: { isBatch: true, packSize: 4, priceCents: 4000, price: "40.00", fulfillment: "pickup", buyPath: "/app/products/batch-8000007" },
        label: "The Show Pond",
        caption: "The planted display — a mix of Steve's lines under blue light.",
        photo: `${MEDIA}/hero/show-pond-blue.jpg`,
        facts: { tankType: "Planted display" },
        specimens: [
          {
            publicName: "Mixed medaka",
            species: { commonName: "Japanese rice fish", scientificName: "Oryzias latipes" },
            story: "A community display holding several of the lines Steve breeds.",
          },
        ],
      },
      {
        slug: "pink-saffire",
        guideUrl: "/medaka-morphs#pink-saffire",
        commerce: { isBatch: true, packSize: 4, priceCents: 7500, price: "75.00", fulfillment: "pickup", buyPath: "/app/products/batch-8000001" },
        label: "Pink Saffire",
        caption: "Pink/lavender medaka with blue eyes.",
        photo: `${MEDIA}/lines/pink-saffire/IMG_20260907_165711_303.jpg`,
        facts: { tankType: "Breeding line" },
        specimens: [
          {
            publicName: "Pink Saffire",
            species: { commonName: "Japanese rice fish", scientificName: "Oryzias latipes" },
            story: "Steve's pink/lavender saffire line.",
          },
        ],
      },
      {
        slug: "echos-of-the-moon",
        guideUrl: "/medaka-morphs#echos-of-the-moon",
        commerce: { isBatch: true, packSize: 2, priceCents: 6000, price: "60.00", fulfillment: "pickup", buyPath: "/app/products/batch-8000003" },
        label: "Echos of the Moon",
        caption: "One of Steve's worked medaka lines.",
        photo: `${MEDIA}/lines/echos-of-the-moon/IMG_20260907_171300_216.jpg`,
        facts: { tankType: "Breeding line" },
        specimens: [
          {
            publicName: "Echos of the Moon",
            species: { commonName: "Japanese rice fish", scientificName: "Oryzias latipes" },
            story: "The Echos of the Moon line.",
          },
        ],
      },
      {
        slug: "gladio",
        guideUrl: "/medaka-morphs#gladio",
        commerce: { isBatch: true, packSize: 2, priceCents: 8000, price: "80.00", fulfillment: "pickup", buyPath: "/app/products/batch-8000002" },
        label: "Gladio",
        caption: "Silvery-white medaka with flowing long fins.",
        photo: `${MEDIA}/lines/gladio/IMG_20260907_170316_911.jpg`,
        facts: { tankType: "Breeding line" },
        specimens: [
          {
            publicName: "Gladio",
            species: { commonName: "Japanese rice fish", scientificName: "Oryzias latipes" },
            story: "A silvery-white long-fin line.",
          },
        ],
      },
      {
        slug: "shinkai",
        guideUrl: "/medaka-morphs#shinkai",
        commerce: { isBatch: true, packSize: 4, priceCents: 5000, price: "50.00", fulfillment: "pickup", buyPath: "/app/products/batch-8000004" },
        label: "Shinkai",
        caption: "A silvery, translucent line kept as a school.",
        photo: `${MEDIA}/lines/shinkai/IMG_20260907_171554_047.jpg`,
        facts: { tankType: "Breeding line" },
        specimens: [
          {
            publicName: "Shinkai",
            species: { commonName: "Japanese rice fish", scientificName: "Oryzias latipes" },
            story: "Silvery/translucent medaka.",
          },
        ],
      },
      {
        slug: "long-fin-red-emperor",
        guideUrl: "/medaka-morphs#long-fin-red-emperor",
        commerce: { isBatch: true, packSize: 2, priceCents: 7500, price: "75.00", fulfillment: "pickup", buyPath: "/app/products/batch-8000005" },
        label: "Long Fin Red Emperor",
        caption: "Orange-crimson long-fin medaka with a dark tail.",
        photo: `${MEDIA}/posters/VID_20260901_115510_665.jpg`,
        facts: { tankType: "Outdoor breeding tub" },
        specimens: [
          {
            publicName: "Long Fin Red Emperor",
            species: { commonName: "Japanese rice fish", scientificName: "Oryzias latipes" },
            story: "An orange-crimson long-fin kept in the outdoor tubs.",
          },
        ],
      },
      {
        slug: "blue-aurora-lame",
        guideUrl: "/medaka-morphs#blue-aurora-lame",
        commerce: { isBatch: true, packSize: 2, priceCents: 5000, price: "50.00", fulfillment: "pickup", buyPath: "/app/products/batch-8000006" },
        label: "Blue Aurora Lamé",
        caption: "Vivid electric-blue juveniles.",
        photo: `${MEDIA}/posters/VID_20260901_115521_576.jpg`,
        facts: { tankType: "Outdoor breeding tub" },
        specimens: [
          {
            publicName: "Blue Aurora Lamé",
            species: { commonName: "Japanese rice fish", scientificName: "Oryzias latipes" },
            story: "Electric-blue juveniles growing out in the tubs.",
          },
        ],
      },
    ],
  },
};

const CURATED_SHOWCASES = {
  ggstevericefishnj: STEVE_ROOM,
};

export function curatedShowcasesEnabled() {
  return process.env.SHOWCASE_CURATED_ENABLED === "true";
}

/**
 * Look up a curated showcase entry by normalized slug.
 * Returns { room, defaultPublic, ownerWallet } or null when not curated / disabled.
 * The effective public/private state is the stored visibility flag when present,
 * otherwise defaultPublic (see api/_lib/curatedVisibility.js).
 */
export function getCuratedEntry(slug) {
  if (!curatedShowcasesEnabled()) return null;
  const entry = CURATED_SHOWCASES[slug];
  if (!entry) return null;
  return {
    room: entry.room,
    defaultPublic: entry.public !== false,
    ownerWallet: entry.ownerWallet || null,
  };
}
