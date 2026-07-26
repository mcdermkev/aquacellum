import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import {
  DIFFICULTY,
  DIFFICULTY_UNKNOWN,
  normalizeDifficulty,
  difficultyToCareLevel,
  toCatalogEntry,
  buildGlobalCatalog,
  CARE_LABELS,
  CARE_BADGE_CLASS,
} from "./speciesCatalog.js";

// ─────────────────────────────────────────────────────────────────────────────
// Legacy reference implementations. These are the EXACT algorithms that lived
// in the app (`BreedGallery.globalRefList`) and the public page
// (`database.html`) before this module existed. The tests assert the new
// module reproduces them, so any drift is a failing test rather than a silent
// divergence between the app and the marketing site.
// ─────────────────────────────────────────────────────────────────────────────

// --- App: BreedGallery.globalRefList (verbatim) ---
const APP_DIFFICULTY_MAP = {
  easy: 0, beginner: 0, intermediate: 1, medium: 1, difficult: 2, advanced: 2, expert: 3,
};
function legacyGlobalRefList(globalData) {
  if (!globalData || globalData.length === 0) return [];
  const seenNames = new Set();
  const seenCodes = new Set();
  const catalog = [];
  for (const item of globalData) {
    const scientificNameLower = item.scientificName.toLowerCase();
    if (seenNames.has(scientificNameLower) || seenCodes.has(item.specCode)) continue;
    seenNames.add(scientificNameLower);
    seenCodes.add(item.specCode);
    const diffStr = (item.tankMetrics?.difficulty || "easy").toLowerCase();
    const careLevel = APP_DIFFICULTY_MAP[diffStr] ?? 1;
    catalog.push({
      speciesId: item.specCode,
      allSpeciesIds: [item.specCode],
      scientificName: item.scientificName,
      commonName: item.commonName,
      canonicalIpfsUri: "ipfs://placeholder",
      careLevel,
      minTemp: item.tankMetrics?.tempRangeCelsius?.[0] ?? 22.0,
      maxTemp: item.tankMetrics?.tempRangeCelsius?.[1] ?? 28.0,
      minPh: item.tankMetrics?.phRange?.[0] ?? 6.5,
      maxPh: item.tankMetrics?.phRange?.[1] ?? 7.5,
      specimenCount: 0,
      isGlobal: true,
    });
  }
  return catalog;
}
// The legacy fields the module must reproduce byte-for-byte (excludes the new
// `difficulty` / `profile` additions).
const LEGACY_KEYS = [
  "speciesId", "allSpeciesIds", "scientificName", "commonName", "canonicalIpfsUri",
  "careLevel", "minTemp", "maxTemp", "minPh", "maxPh", "specimenCount", "isGlobal",
];
const pickLegacy = (entry) => LEGACY_KEYS.reduce((o, k) => ((o[k] = entry[k]), o), {});

// --- Public: database.html difficulty helpers (verbatim) ---
function webGetDifficultyClass(diff) {
  if (!diff) return "badge-unknown";
  return "badge-" + diff.toLowerCase();
}
function webGetTierClass(diff) {
  if (!diff) return "tier-beginner";
  const d = diff.toLowerCase();
  if (d === "beginner") return "tier-beginner";
  if (d === "intermediate") return "tier-intermediate";
  if (d === "advanced") return "tier-advanced";
  if (d === "difficult") return "tier-difficult";
  return "tier-beginner";
}
function webGetDifficultyWeight(diff) {
  if (!diff) return 0;
  const d = diff.toLowerCase();
  if (d === "beginner") return 1;
  if (d === "intermediate") return 2;
  if (d === "advanced") return 3;
  if (d === "difficult") return 4;
  return 0;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

// A fully-specified record (Convict Cichlid shape from fishbase_master.json).
const CONVICT = {
  specCode: 3615,
  scientificName: "Amatitlania nigrofasciata",
  commonName: "Convict Cichlid",
  maxLengthCm: 12.2,
  tankMetrics: {
    tempRangeCelsius: [20, 28],
    phRange: [7, 8],
    difficulty: "Beginner",
    minVolumeGallons: 30,
  },
  ecology: { socialBehavior: "Highly territorial and aggressive" },
  diet: { trophicLevel: "Omnivore" },
};

// A record with no tankMetrics at all — exercises the fabricated display
// fallbacks and the "missing difficulty → easy" app quirk.
const SPARSE = {
  specCode: 999,
  scientificName: "Mysteryus incognitus",
  commonName: "Mystery Fish",
};

describe("normalizeDifficulty — parity with database.html card helpers", () => {
  const rawValues = ["Beginner", "Intermediate", "Advanced", "Difficult", "Unknown", "", null, undefined];

  it("reproduces getDifficultyClass / getTierClass / getDifficultyWeight exactly", () => {
    for (const raw of rawValues) {
      const d = normalizeDifficulty(raw);
      // database.html defaults a missing difficulty to the string 'Unknown'
      // before calling the class helpers, but calls getDifficultyWeight on the
      // raw (possibly undefined) value.
      const asShown = raw || "Unknown";
      expect(d.badgeClass).toBe(webGetDifficultyClass(asShown));
      expect(d.tierClass).toBe(webGetTierClass(asShown));
      expect(d.order).toBe(webGetDifficultyWeight(raw || undefined));
    }
  });

  it("is case-insensitive and trims", () => {
    expect(normalizeDifficulty("  aDvAnCeD ")).toBe(DIFFICULTY.advanced);
  });

  it("keeps Advanced and Difficult as distinct tiers (fidelity the app careLevel loses)", () => {
    expect(DIFFICULTY.advanced.tierClass).toBe("tier-advanced");
    expect(DIFFICULTY.difficult.tierClass).toBe("tier-difficult");
    expect(DIFFICULTY.advanced.order).toBe(3);
    expect(DIFFICULTY.difficult.order).toBe(4);
  });

  it("maps unknown/missing to the shared unknown descriptor", () => {
    expect(normalizeDifficulty(undefined)).toBe(DIFFICULTY_UNKNOWN);
    expect(normalizeDifficulty("nonsense")).toBe(DIFFICULTY_UNKNOWN);
  });

  // The new contract is a deliberate SUPERSET of the legacy database.html
  // helpers: it trims + resolves aliases where they did not. This is documented
  // and intentional; it never diverges for shipped data (only the four
  // canonical words appear in the curated catalog), but we pin the intended
  // alias/trim behavior here so the divergence from the raw legacy string
  // handling is explicit rather than accidental.
  it("resolves aliases the legacy helpers did not (intentional superset)", () => {
    expect(normalizeDifficulty("easy")).toBe(DIFFICULTY.beginner);   // legacy: "badge-easy"
    expect(normalizeDifficulty("medium")).toBe(DIFFICULTY.intermediate);
    expect(normalizeDifficulty("hard")).toBe(DIFFICULTY.advanced);
    expect(normalizeDifficulty("expert")).toBe(DIFFICULTY.difficult);
    // careLevel aliases match the legacy DIFFICULTY_MAP (expert kept distinct at 3)
    expect(difficultyToCareLevel("expert")).toBe(3);
    expect(difficultyToCareLevel("hard")).toBe(1); // "hard" wasn't in the legacy map → default 1
  });

  it("trims and lower-cases raw values before matching", () => {
    expect(normalizeDifficulty("  Beginner ").badgeClass).toBe("badge-beginner");
    expect(difficultyToCareLevel("  ADVANCED  ")).toBe(2);
  });
});

describe("difficultyToCareLevel — parity with the app DIFFICULTY_MAP", () => {
  it("matches the legacy lookup for every key including the miss default", () => {
    for (const [raw, expected] of Object.entries(APP_DIFFICULTY_MAP)) {
      expect(difficultyToCareLevel(raw)).toBe(expected);
    }
    expect(difficultyToCareLevel("nonsense")).toBe(1); // ?? 1 default
    expect(difficultyToCareLevel(undefined)).toBe(1);
  });
});

describe("toCatalogEntry — byte-parity with globalRefList", () => {
  it("reproduces the legacy entry for a fully-specified record", () => {
    const [legacy] = legacyGlobalRefList([CONVICT]);
    expect(pickLegacy(toCatalogEntry(CONVICT))).toEqual(legacy);
  });

  it("reproduces the legacy fabricated fallbacks + 'easy' default for a sparse record", () => {
    const [legacy] = legacyGlobalRefList([SPARSE]);
    const entry = toCatalogEntry(SPARSE);
    expect(pickLegacy(entry)).toEqual(legacy);
    // explicit: sparse record → careLevel 0 (easy), 22–28°C / pH 6.5–7.5 display
    expect(entry.careLevel).toBe(0);
    expect([entry.minTemp, entry.maxTemp, entry.minPh, entry.maxPh]).toEqual([22, 28, 6.5, 7.5]);
  });

  it("adds an honest profile (null ranges when unknown) alongside display fallbacks", () => {
    const entry = toCatalogEntry(SPARSE);
    expect(entry.profile.tempRange).toBeNull();
    expect(entry.profile.phRange).toBeNull();
    // The display fields still show the fabricated range — the two are decoupled.
    expect(entry.minTemp).toBe(22);
  });

  it("adds the canonical difficulty descriptor", () => {
    expect(toCatalogEntry(CONVICT).difficulty).toBe(DIFFICULTY.beginner);
    expect(toCatalogEntry(SPARSE).difficulty).toBe(DIFFICULTY.beginner); // 'easy' default
  });
});

describe("buildGlobalCatalog — byte-parity with globalRefList dedup", () => {
  const DUPE_NAME = { ...CONVICT, specCode: 4000 }; // same name, different code
  const DUPE_CODE = { specCode: 3615, scientificName: "Other name", commonName: "Other" };
  const NEON = {
    specCode: 100, scientificName: "Paracheirodon innesi", commonName: "Neon Tetra",
    tankMetrics: { tempRangeCelsius: [20, 26], phRange: [6, 7], difficulty: "Intermediate" },
  };

  it("matches the legacy list (minus new fields) over a set with duplicates", () => {
    const input = [CONVICT, DUPE_NAME, DUPE_CODE, NEON];
    const legacy = legacyGlobalRefList(input);
    const built = buildGlobalCatalog(input);
    expect(built.map(pickLegacy)).toEqual(legacy);
  });

  it("drops duplicates by name and by specCode (first wins)", () => {
    const built = buildGlobalCatalog([CONVICT, DUPE_NAME, DUPE_CODE, NEON]);
    expect(built.map((e) => e.speciesId)).toEqual([3615, 100]);
  });

  it("returns [] for empty/invalid input and skips records without a name", () => {
    expect(buildGlobalCatalog([])).toEqual([]);
    expect(buildGlobalCatalog(null)).toEqual([]);
    expect(buildGlobalCatalog([{ specCode: 1 }, NEON]).map((e) => e.speciesId)).toEqual([100]);
  });
});

describe("care-label constants are the canonical single copy", () => {
  it("keeps the exact arrays SpeciesCardPremium/BreedGallery hardcoded", () => {
    expect(CARE_LABELS).toEqual(["Easy", "Medium", "Difficult", "Expert"]);
    expect(CARE_BADGE_CLASS).toEqual(["easy", "medium", "hard", "expert"]);
  });
});

describe("public browser mirror stays in lockstep with the module", () => {
  // The static marketing page cannot import ESM from src/, so it loads a small
  // mirror at /js/species-catalog.js as a <script> (window global). This test
  // evaluates that same file in a controlled scope — exercising its real
  // global-assignment path — and asserts it agrees with the canonical module,
  // so the two runtimes can't drift.
  let mirror;
  try {
    const src = readFileSync(
      fileURLToPath(new URL("../../public/js/species-catalog.js", import.meta.url)),
      "utf8"
    );
    const fakeRoot = {};
    const mod = { exports: {} };
    // Provide `module`, `window`, `globalThis` so the UMD wrapper resolves to
    // both module.exports and the window global; either satisfies the mirror.
    // eslint-disable-next-line no-new-func
    new Function("module", "window", "globalThis", src)(mod, fakeRoot, fakeRoot);
    mirror = mod.exports?.normalizeDifficulty ? mod.exports : fakeRoot.SpeciesCatalog;
  } catch {
    mirror = null;
  }

  it("exposes the mirror module", () => {
    expect(mirror, "frontend/public/js/species-catalog.js should be require-able").toBeTruthy();
  });

  it("agrees on normalizeDifficulty across all inputs", () => {
    if (!mirror) return;
    for (const raw of ["Beginner", "Intermediate", "Advanced", "Difficult", "Unknown", "", null, undefined]) {
      const m = mirror.normalizeDifficulty(raw);
      const c = normalizeDifficulty(raw);
      expect(m.key).toBe(c.key);
      expect(m.badgeClass).toBe(c.badgeClass);
      expect(m.tierClass).toBe(c.tierClass);
      expect(m.order).toBe(c.order);
    }
  });

  it("agrees on difficultyToCareLevel", () => {
    if (!mirror) return;
    for (const raw of ["easy", "beginner", "intermediate", "medium", "advanced", "difficult", "expert", "nope", undefined]) {
      expect(mirror.difficultyToCareLevel(raw)).toBe(difficultyToCareLevel(raw));
    }
  });
});
