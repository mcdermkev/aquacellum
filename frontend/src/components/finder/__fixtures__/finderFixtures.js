/**
 * finderFixtures.js — the canonical Fish Finder test dataset
 * (Fish Finder Rework, Task 11).
 *
 * One shared, documented set of species records, catalog entries, aquarium
 * contexts and marketplace listings, so tests that exercise the discovery →
 * card → detail path all describe the same world instead of re-inventing
 * species inline.
 *
 * ── Why the existing finder tests were NOT retrofitted onto this ────────────
 * matchRanking.test.js and discoveryIntents.test.js each define their own
 * Neon/Oscar/Betta records, and those definitions deliberately DISAGREE: Oscar
 * is "Intermediate"/55 gal in the ranking test and "Advanced"/75 gal in the
 * intents test, and their specCodes differ (100+ vs 1+). Each set is tuned to
 * the boundary its own suite probes. Collapsing them into one shared record
 * would silently change what those suites assert, so they were left alone —
 * this module serves the presentation snapshots and new tests.
 *
 * Every species here is a REAL species with plausible real requirements; the
 * numbers are ordinary aquarium-hobby values, not invented precision. SPARSE is
 * the deliberate exception: it exists to prove the "unknown data is never
 * guessed" rule end to end.
 */

import { toCatalogEntry } from "../../../services/speciesCatalog.js";

// ─── Species records (curated master / "fishbase" shape) ───────────────────

/** Small, hardy, beginner community fish. Fits almost any settled aquarium. */
export const NEON_RECORD = Object.freeze({
  specCode: 5001,
  scientificName: "Paracheirodon innesi",
  commonName: "Neon Tetra",
  maxLengthCm: 3.5,
  family: "Characidae",
  tankMetrics: { tempRangeCelsius: [20, 26], phRange: [6, 7], difficulty: "Beginner", minVolumeGallons: 10 },
  ecology: { socialBehavior: "Peaceful schooling fish, does best in a community aquarium" },
  diet: { trophicLevel: "Omnivore" },
});

/** Nano-friendly centerpiece; warmer water than Neon, so it exercises temp. */
export const BETTA_RECORD = Object.freeze({
  specCode: 5002,
  scientificName: "Betta splendens",
  commonName: "Betta",
  maxLengthCm: 6,
  family: "Osphronemidae",
  tankMetrics: { tempRangeCelsius: [24, 28], phRange: [6, 7.5], difficulty: "Beginner", minVolumeGallons: 5 },
  ecology: { socialBehavior: "Can be territorial toward other bettas" },
  diet: { trophicLevel: "Carnivore" },
});

/** Large cichlid — the "blocked on volume" case for any small aquarium. */
export const OSCAR_RECORD = Object.freeze({
  specCode: 5003,
  scientificName: "Astronotus ocellatus",
  commonName: "Oscar",
  maxLengthCm: 30,
  family: "Cichlidae",
  tankMetrics: { tempRangeCelsius: [22, 27], phRange: [6, 7.5], difficulty: "Advanced", minVolumeGallons: 75 },
  ecology: { socialBehavior: "Territorial and aggressive toward smaller companions" },
  diet: { trophicLevel: "Carnivore" },
});

/** Coldwater: incompatible with a tropical aquarium on temperature alone. */
export const GOLDFISH_RECORD = Object.freeze({
  specCode: 5004,
  scientificName: "Carassius auratus",
  commonName: "Goldfish",
  maxLengthCm: 25,
  family: "Cyprinidae",
  tankMetrics: { tempRangeCelsius: [10, 21], phRange: [6.5, 8], difficulty: "Beginner", minVolumeGallons: 30 },
  diet: { trophicLevel: "Omnivore" },
});

/**
 * Identity only — no ranges, no volume, no difficulty. Any surface that claims
 * a verdict for this species is fabricating one; the honest outcome is a
 * data-caution, never "good fit".
 */
export const SPARSE_RECORD = Object.freeze({
  specCode: 5005,
  scientificName: "Mysteryus incognitus",
  commonName: "Mystery Fish",
});

export const ALL_RECORDS = Object.freeze([
  NEON_RECORD,
  BETTA_RECORD,
  OSCAR_RECORD,
  GOLDFISH_RECORD,
  SPARSE_RECORD,
]);

// ─── Catalog entries (what the finder actually renders from) ────────────────

export const NEON = toCatalogEntry(NEON_RECORD);
export const BETTA = toCatalogEntry(BETTA_RECORD);
export const OSCAR = toCatalogEntry(OSCAR_RECORD);
export const GOLDFISH = toCatalogEntry(GOLDFISH_RECORD);
export const SPARSE = toCatalogEntry(SPARSE_RECORD);

export const ALL_ENTRIES = Object.freeze([NEON, BETTA, OSCAR, GOLDFISH, SPARSE]);

// ─── Aquarium contexts (the shape FishFinder derives via tankFitInputs) ─────

/** A settled 20 gal tropical community aquarium — the common case. */
export const COMMUNITY_AQUARIUM = Object.freeze({ volume: 20, temp: 24, ph: 7.0 });
/** A 5 gal nano — small enough to block most species on volume. */
export const NANO_AQUARIUM = Object.freeze({ volume: 5, temp: 25, ph: 7.0 });
/** A 75 gal that can actually house an Oscar. */
export const LARGE_AQUARIUM = Object.freeze({ volume: 75, temp: 25, ph: 7.0 });
/** Unheated/cool water — the coldwater case. */
export const COLDWATER_AQUARIUM = Object.freeze({ volume: 30, temp: 18, ph: 7.2 });

export const ALL_AQUARIUMS = Object.freeze({
  community: COMMUNITY_AQUARIUM,
  nano: NANO_AQUARIUM,
  large: LARGE_AQUARIUM,
  coldwater: COLDWATER_AQUARIUM,
});

// ─── Marketplace listings (for the availability / acquisition hook) ─────────
//
// Shape mirrors what buildSpeciesAvailability consumes (the parsed `data` blob
// of an active aquadex_listings row). Two sellers on Neon so the plural and the
// from-price both get exercised; Betta has a single seller; Oscar and Goldfish
// have none, which is the "not currently for sale" state.

export const LISTINGS = Object.freeze([
  Object.freeze({
    id: "L-1",
    seller: "0x1111111111111111111111111111111111111111",
    speciesId: NEON_RECORD.specCode,
    scientificName: NEON_RECORD.scientificName,
    commonName: NEON_RECORD.commonName,
    priceCentsUSD: 499,
    quantity: 12,
    isShipping: true,
    active: true,
  }),
  Object.freeze({
    id: "L-2",
    seller: "0x2222222222222222222222222222222222222222",
    speciesId: NEON_RECORD.specCode,
    scientificName: NEON_RECORD.scientificName,
    commonName: NEON_RECORD.commonName,
    priceCentsUSD: 350,
    quantity: 6,
    isShipping: false,
    active: true,
  }),
  Object.freeze({
    id: "L-3",
    seller: "0x3333333333333333333333333333333333333333",
    speciesId: BETTA_RECORD.specCode,
    scientificName: BETTA_RECORD.scientificName,
    commonName: BETTA_RECORD.commonName,
    priceCentsUSD: 2500,
    quantity: 1,
    isShipping: true,
    active: true,
  }),
]);
