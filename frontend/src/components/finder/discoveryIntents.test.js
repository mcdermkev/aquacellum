import { describe, it, expect } from "vitest";
import { DISCOVERY_INTENTS, speciesMatchesIntent, filterByIntent } from "./discoveryIntents.js";
import { toCatalogEntry } from "../../services/speciesCatalog.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────
// Master (fishbase) records exercising each intent's positive/negative cases.

const NEON_RECORD = {
  specCode: 1,
  scientificName: "Paracheirodon innesi",
  commonName: "Neon Tetra",
  maxLengthCm: 3.5,
  family: "Characidae",
  tankMetrics: { tempRangeCelsius: [20, 26], phRange: [6, 7], difficulty: "Beginner", minVolumeGallons: 10 },
  ecology: { socialBehavior: "Peaceful schooling fish, does best in community tanks" },
  diet: { trophicLevel: "Omnivore" },
};

const OSCAR_RECORD = {
  specCode: 2,
  scientificName: "Astronotus ocellatus",
  commonName: "Oscar",
  maxLengthCm: 30,
  family: "Cichlidae",
  tankMetrics: { tempRangeCelsius: [22, 27], phRange: [6, 7.5], difficulty: "Advanced", minVolumeGallons: 75 },
  ecology: { socialBehavior: "Territorial and aggressive toward smaller tankmates" },
  diet: { trophicLevel: "Carnivore" },
};

const PLECO_RECORD = {
  specCode: 3,
  scientificName: "Hypostomus plecostomus",
  commonName: "Common Pleco",
  maxLengthCm: 40,
  family: "Loricariidae",
  tankMetrics: { tempRangeCelsius: [22, 28], phRange: [6.5, 7.5], difficulty: "Beginner", minVolumeGallons: 55 },
  diet: { trophicLevel: "Herbivore", fooditems: "Algae, biofilm, and soft vegetation" },
};

const GOLDFISH_RECORD = {
  specCode: 4,
  scientificName: "Carassius auratus",
  commonName: "Goldfish",
  maxLengthCm: 25,
  family: "Cyprinidae",
  tankMetrics: { tempRangeCelsius: [10, 21], phRange: [6.5, 8], difficulty: "Beginner", minVolumeGallons: 30 },
};

const BETTA_RECORD = {
  specCode: 5,
  scientificName: "Betta splendens",
  commonName: "Betta",
  maxLengthCm: 6,
  family: "Osphronemidae",
  tankMetrics: { tempRangeCelsius: [24, 28], phRange: [6, 7.5], difficulty: "Beginner", minVolumeGallons: 5 },
  ecology: { socialBehavior: "Can be territorial toward other bettas" },
};

// A species with no curated fields at all beyond identity — used to prove the
// "unknown → excluded, never guessed" rule for every intent.
const SPARSE_RECORD = {
  specCode: 6,
  scientificName: "Mysteryus incognitus",
  commonName: "Mystery Fish",
};

const ALL_RECORDS = [NEON_RECORD, OSCAR_RECORD, PLECO_RECORD, GOLDFISH_RECORD, BETTA_RECORD, SPARSE_RECORD];

const NEON = toCatalogEntry(NEON_RECORD);
const OSCAR = toCatalogEntry(OSCAR_RECORD);
const PLECO = toCatalogEntry(PLECO_RECORD);
const GOLDFISH = toCatalogEntry(GOLDFISH_RECORD);
const BETTA = toCatalogEntry(BETTA_RECORD);
const SPARSE = toCatalogEntry(SPARSE_RECORD);

// A contract-shape entry (flat fields, no .profile) for the same species as
// NEON_RECORD, to prove the master-record join works for on-chain entries too.
const NEON_CONTRACT_ENTRY = {
  speciesId: 101,
  scientificName: "Paracheirodon innesi",
  commonName: "Neon Tetra",
  careLevel: 1, // deliberately NOT 0, to prove the beginner intent falls back to the master record
  minTemp: 20, maxTemp: 26,
  minPh: 6, maxPh: 7,
  specimenCount: 3,
};

describe("DISCOVERY_INTENTS", () => {
  it("is exactly the six documented intents (no fabricated 'colorful' intent)", () => {
    expect(DISCOVERY_INTENTS.map((i) => i.id)).toEqual([
      "beginner", "peaceful", "nano", "centerpiece", "cleanup", "coldwater",
    ]);
    expect(DISCOVERY_INTENTS.some((i) => i.id === "colorful")).toBe(false);
  });
});

describe("speciesMatchesIntent — beginner", () => {
  it("matches an Easy-difficulty species", () => {
    expect(speciesMatchesIntent(NEON, "beginner", { fishbaseData: ALL_RECORDS })).toBe(true);
  });
  it("excludes an Advanced-difficulty species", () => {
    expect(speciesMatchesIntent(OSCAR, "beginner", { fishbaseData: ALL_RECORDS })).toBe(false);
  });
  it("falls back to the master record when the entry's own careLevel isn't Easy", () => {
    expect(speciesMatchesIntent(NEON_CONTRACT_ENTRY, "beginner", { fishbaseData: ALL_RECORDS })).toBe(true);
  });
});

describe("speciesMatchesIntent — peaceful", () => {
  it("matches a species with schooling/peaceful social behavior text", () => {
    expect(speciesMatchesIntent(NEON, "peaceful", { fishbaseData: ALL_RECORDS })).toBe(true);
  });
  it("excludes a species with aggressive/territorial social behavior text", () => {
    expect(speciesMatchesIntent(OSCAR, "peaceful", { fishbaseData: ALL_RECORDS })).toBe(false);
    expect(speciesMatchesIntent(BETTA, "peaceful", { fishbaseData: ALL_RECORDS })).toBe(false);
  });
  it("excludes a species with no known social-behavior text (unknown, not guessed)", () => {
    expect(speciesMatchesIntent(SPARSE, "peaceful", { fishbaseData: ALL_RECORDS })).toBe(false);
  });
});

describe("speciesMatchesIntent — nano", () => {
  it("matches a small species (maxLengthCm <= 5)", () => {
    expect(speciesMatchesIntent(NEON, "nano", { fishbaseData: ALL_RECORDS })).toBe(true);
  });
  it("matches a species with a small minimum volume even if size is larger", () => {
    expect(speciesMatchesIntent(BETTA, "nano", { fishbaseData: ALL_RECORDS })).toBe(true); // minVolumeGallons 5
  });
  it("excludes a large species with a large minimum volume", () => {
    expect(speciesMatchesIntent(OSCAR, "nano", { fishbaseData: ALL_RECORDS })).toBe(false);
  });
  it("excludes when both size and minimum volume are unknown", () => {
    expect(speciesMatchesIntent(SPARSE, "nano", { fishbaseData: ALL_RECORDS })).toBe(false);
  });
});

describe("speciesMatchesIntent — centerpiece", () => {
  it("matches a large species (maxLengthCm >= 12)", () => {
    expect(speciesMatchesIntent(OSCAR, "centerpiece", { fishbaseData: ALL_RECORDS })).toBe(true);
    expect(speciesMatchesIntent(PLECO, "centerpiece", { fishbaseData: ALL_RECORDS })).toBe(true);
  });
  it("excludes a small species", () => {
    expect(speciesMatchesIntent(NEON, "centerpiece", { fishbaseData: ALL_RECORDS })).toBe(false);
  });
  it("excludes when adult size is unknown", () => {
    expect(speciesMatchesIntent(SPARSE, "centerpiece", { fishbaseData: ALL_RECORDS })).toBe(false);
  });
});

describe("speciesMatchesIntent — cleanup", () => {
  it("matches an herbivore whose diet text mentions algae/biofilm", () => {
    expect(speciesMatchesIntent(PLECO, "cleanup", { fishbaseData: ALL_RECORDS })).toBe(true);
  });
  it("matches by family (loricariidae/callichthyidae) alone", () => {
    const noTextPleco = toCatalogEntry({ ...PLECO_RECORD, diet: undefined });
    expect(speciesMatchesIntent(noTextPleco, "cleanup", {
      fishbaseData: [{ ...PLECO_RECORD, diet: undefined }],
    })).toBe(true);
  });
  it("matches a plant entry", () => {
    const plantRecord = { specCode: 7, scientificName: "Anubias barteri", commonName: "Anubias", type: "plant" };
    const plant = toCatalogEntry(plantRecord);
    expect(speciesMatchesIntent(plant, "cleanup", { fishbaseData: [plantRecord] })).toBe(true);
  });
  it("excludes a carnivore with no cleanup-crew signal", () => {
    expect(speciesMatchesIntent(OSCAR, "cleanup", { fishbaseData: ALL_RECORDS })).toBe(false);
  });
  it("excludes when nothing relevant is known", () => {
    expect(speciesMatchesIntent(SPARSE, "cleanup", { fishbaseData: ALL_RECORDS })).toBe(false);
  });
});

describe("speciesMatchesIntent — coldwater", () => {
  it("matches a species whose max temp is below 22°C", () => {
    expect(speciesMatchesIntent(GOLDFISH, "coldwater", { fishbaseData: ALL_RECORDS })).toBe(true);
  });
  it("excludes a tropical species", () => {
    expect(speciesMatchesIntent(NEON, "coldwater", { fishbaseData: ALL_RECORDS })).toBe(false);
  });
  it("excludes when temperature range is unknown", () => {
    expect(speciesMatchesIntent(SPARSE, "coldwater", { fishbaseData: ALL_RECORDS })).toBe(false);
  });
});

describe("speciesMatchesIntent — general rules", () => {
  it("returns false for a null/undefined entry", () => {
    expect(speciesMatchesIntent(null, "beginner", { fishbaseData: ALL_RECORDS })).toBe(false);
    expect(speciesMatchesIntent(undefined, "beginner", { fishbaseData: ALL_RECORDS })).toBe(false);
  });
  it("returns false for an unknown intent id", () => {
    expect(speciesMatchesIntent(NEON, "colorful", { fishbaseData: ALL_RECORDS })).toBe(false);
    expect(speciesMatchesIntent(NEON, null, { fishbaseData: ALL_RECORDS })).toBe(false);
  });
});

describe("filterByIntent", () => {
  const entries = [NEON, OSCAR, PLECO, GOLDFISH, BETTA, SPARSE];

  it("filters down to only the matching entries for a real intent", () => {
    const result = filterByIntent(entries, "beginner", { fishbaseData: ALL_RECORDS });
    const ids = result.map((e) => e.speciesId);
    expect(ids).toContain(NEON.speciesId);
    expect(ids).toContain(PLECO.speciesId);
    expect(ids).toContain(GOLDFISH.speciesId);
    expect(ids).toContain(BETTA.speciesId);
    expect(ids).not.toContain(OSCAR.speciesId);
  });

  it("returns all entries unchanged when intentId is null", () => {
    const result = filterByIntent(entries, null, { fishbaseData: ALL_RECORDS });
    expect(result).toEqual(entries);
  });

  it("returns all entries unchanged when intentId is unknown", () => {
    const result = filterByIntent(entries, "colorful", { fishbaseData: ALL_RECORDS });
    expect(result).toEqual(entries);
  });

  it("returns an empty array for an empty/missing entries list", () => {
    expect(filterByIntent([], "beginner", { fishbaseData: ALL_RECORDS })).toEqual([]);
    expect(filterByIntent(null, "beginner", { fishbaseData: ALL_RECORDS })).toEqual([]);
  });
});
