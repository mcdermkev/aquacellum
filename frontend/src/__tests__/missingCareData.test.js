/**
 * A species with no recorded care data must stay "unknown" everywhere.
 *
 * The shared catalog normalizer used to backfill missing non-diet fields with
 * invented values: family / comments / socialBehavior / reproduction.* ->
 * "Information arriving soon", biotope -> "Generic Biotope Details",
 * phMin / phMax -> 6.5 / 7.5, hardnessRange -> "5 - 15 dGH", tempCeiling -> 28.
 * The pH numbers made a species with no pH data "fit" any 6.5 to 7.5 tank.
 * These tests pin the null path through the normalizer and its consumers.
 *
 * Run with: npx vitest run src/__tests__/missingCareData.test.js
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { normalizeSpeciesRecord } from "../services/normalizeSpeciesRecord.js";
import {
  CARE_NOT_RECORDED,
  realCareText,
  realCareNumber,
  realRange,
  checkRange,
  entryCareRanges,
  recordedCareRanges,
  formatCareRange,
} from "../services/speciesCare.js";
import { normalizeSpeciesProfile } from "../services/shippingSafety.js";
import { evaluateTankFit } from "../services/addOnRecommender.js";
import { rankCompatibleTanks, deriveSpeciesProfile } from "../services/compatibleTanks.js";
import { toCatalogEntry } from "../services/speciesCatalog.js";
import { assessSpeciesFit, fitPresentationKind } from "../services/speciesFit.js";
import { speciesMatchesIntent } from "../components/finder/discoveryIntents.js";
import { buildListingDraftFromSpecies } from "../services/listingDraft.js";
import { getSpeciesCare } from "../components/logbook/SpeciesCareGuide";
import { reefSpeciesFactLines } from "../reef/hooks/useNarration.js";
import { formatSpeciesForContext } from "../../api/_lib/speciesIndex.js";

const CATALOG = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../public/fishbase_master.json", import.meta.url)), "utf8")
);

const PLACEHOLDER_RE = /information arriving soon|generic biotope details/i;

// Shaped like the 123 catalog fish with no pH or temperature range at all.
const NO_CARE_FISH = {
  specCode: 910001,
  scientificName: "Testus nocareus",
  commonName: "No-care test fish",
  type: "fish",
  maxLengthCm: 5,
  diet: { trophicLevel: "Omnivore" },
};

// Stale values an older Dexie cache (or the old normalizer) may still hold.
const PLACEHOLDER_FISH = {
  ...NO_CARE_FISH,
  specCode: 910002,
  scientificName: "Testus placeholderus",
  family: "Information arriving soon",
  ecology: {
    comments: "Information arriving soon",
    biotope: "Generic Biotope Details",
    socialBehavior: "Information arriving soon",
    hardnessRange: "",
    phMin: null,
    phMax: undefined,
    tempCeiling: null,
  },
  reproduction: { spawningTrait: "Information arriving soon", layoutRequirement: "", comments: "   " },
};

// Only tankMetrics, no ecology block: the pH / ceiling derivation is real data.
const METRICS_ONLY_FISH = {
  specCode: 910003,
  scientificName: "Testus metricus",
  commonName: "Metrics-only test fish",
  type: "fish",
  family: "Cyprinidae",
  tankMetrics: { tempRangeCelsius: [20, 25], phRange: [6, 7], minVolumeGallons: 10 },
};

// Fully recorded, shaped like the Convict Cichlid record.
const REAL_FISH = {
  specCode: 910004,
  scientificName: "Testus realis",
  commonName: "Real test fish",
  type: "fish",
  family: "Cichlidae",
  maxLengthCm: 10,
  tankMetrics: { tempRangeCelsius: [20, 28], phRange: [7, 8], minVolumeGallons: 30, difficulty: "Beginner" },
  ecology: {
    comments: "Hardy and territorial.",
    biotope: "Rivers and lakes in Central America with rocky substrate.",
    phMin: 7,
    phMax: 8,
    hardnessRange: "Moderately hard to hard (10-20 dGH)",
    tempCeiling: 28,
    socialBehavior: "Highly territorial and aggressive, especially when breeding.",
  },
  reproduction: {
    spawningTrait: "Cave spawners with biparental care.",
    layoutRequirement: "Provide caves and flat rocks.",
    comments: "Both parents guard the fry.",
  },
};

const MISSING = [NO_CARE_FISH, PLACEHOLDER_FISH];

// ─── Normalizer ──────────────────────────────────────────────────────────────

describe("normalizeSpeciesRecord keeps missing care data null", () => {
  it.each(MISSING.map((r) => [r.scientificName, r]))("%s: every non-diet fallback is null", (_n, record) => {
    const out = normalizeSpeciesRecord(record);
    expect(out.family).toBeNull();
    expect(out.ecology).toEqual({
      comments: null, biotope: null, phMin: null, phMax: null,
      hardnessRange: null, tempCeiling: null, socialBehavior: null,
    });
    expect(out.reproduction).toEqual({ spawningTrait: null, layoutRequirement: null, comments: null });
    expect(JSON.stringify(out)).not.toMatch(PLACEHOLDER_RE);
    expect(JSON.stringify(out)).not.toMatch(/5 - 15 dGH/);
  });

  it("does not turn a null pH into 0 (Number(null) is 0)", () => {
    const out = normalizeSpeciesRecord({ ecology: { phMin: null, phMax: "", tempCeiling: false } });
    expect(out.ecology.phMin).toBeNull();
    expect(out.ecology.phMax).toBeNull();
    expect(out.ecology.tempCeiling).toBeNull();
  });

  it("derives pH and temperature ceiling from the record's own tankMetrics", () => {
    const out = normalizeSpeciesRecord(METRICS_ONLY_FISH);
    expect(out.ecology.phMin).toBe(6);
    expect(out.ecology.phMax).toBe(7);
    expect(out.ecology.tempCeiling).toBe(25);
    expect(out.ecology.hardnessRange).toBeNull();
    expect(out.ecology.biotope).toBeNull();
    expect(out.family).toBe("Cyprinidae");
  });

  it("keeps recorded values exactly as they are", () => {
    const out = normalizeSpeciesRecord(REAL_FISH);
    expect(out.family).toBe(REAL_FISH.family);
    expect(out.ecology).toEqual(REAL_FISH.ecology);
    expect(out.reproduction).toEqual(REAL_FISH.reproduction);
    expect(out.tankMetrics).toEqual(REAL_FISH.tankMetrics);
  });

  it("across the real catalog: preserves every recorded value and invents none", () => {
    const normalized = CATALOG.map(normalizeSpeciesRecord);
    let noPh = 0;
    CATALOG.forEach((raw, i) => {
      const out = normalized[i];
      const tm = raw.tankMetrics || {};
      const eco = raw.ecology || {};
      expect(out.ecology.phMin).toBe(eco.phMin ?? tm.phRange?.[0] ?? null);
      expect(out.ecology.phMax).toBe(eco.phMax ?? tm.phRange?.[1] ?? null);
      expect(out.ecology.tempCeiling).toBe(eco.tempCeiling ?? tm.tempRangeCelsius?.[1] ?? null);
      for (const key of ["comments", "biotope", "hardnessRange", "socialBehavior"]) {
        if (eco[key] && realCareText(eco[key])) expect(out.ecology[key]).toBe(eco[key]);
        else expect(out.ecology[key]).toBeNull();
      }
      for (const key of ["spawningTrait", "layoutRequirement", "comments"]) {
        const v = raw.reproduction?.[key];
        expect(out.reproduction[key]).toBe(realCareText(v) ? v : null);
      }
      if (out.ecology.phMin == null) noPh++;
    });
    // 123 fish in the bundled catalog carry no pH anywhere (measured 2026-09).
    expect(noPh).toBeGreaterThan(0);
    expect(JSON.stringify(normalized)).not.toMatch(PLACEHOLDER_RE);
  });
});

describe("speciesCare primitives", () => {
  it.each([null, undefined, "", "   ", "Information arriving soon", "Generic Biotope Details", "N/A", 42, {}])(
    "realCareText(%p) is null",
    (value) => expect(realCareText(value)).toBeNull()
  );

  it.each([null, undefined, "", "abc", NaN, Infinity, true])("realCareNumber(%p) is null", (value) => {
    expect(realCareNumber(value)).toBeNull();
  });

  it("keeps real zero and numeric strings", () => {
    expect(realCareNumber(0)).toBe(0);
    expect(realCareNumber("7.2")).toBe(7.2);
    expect(realRange(6, "7")).toEqual([6, 7]);
    expect(realRange(6, null)).toBeNull();
  });

  it("checkRange: missing range or reading is unknown, never pass", () => {
    expect(checkRange(7, null)).toBe("unknown");
    expect(checkRange(7, [null, null])).toBe("unknown");
    expect(checkRange(null, [6, 8])).toBe("unknown");
    expect(checkRange(7, [6, 8])).toBe("pass");
    expect(checkRange(9, [6, 8])).toBe("fail");
    expect(checkRange(8.2, [6, 8], 0.3)).toBe("pass");
  });
});

// ─── Compatibility ───────────────────────────────────────────────────────────

describe("compatibility: no pH on record is not a pass on pH", () => {
  const tank = { volume: 40, temp: 24, ph: 7.0 };

  it("the normalized record carries no pH range into the fit profile", () => {
    const profile = normalizeSpeciesProfile(normalizeSpeciesRecord(NO_CARE_FISH));
    expect(profile.phRange).toBeNull();
    expect(profile.dataConfidence.ph).toBe(false);
  });

  it("evaluateTankFit returns caution with an explicit unknown pH reason, never ok", () => {
    const profile = normalizeSpeciesProfile(normalizeSpeciesRecord(NO_CARE_FISH));
    const fit = evaluateTankFit(profile, tank);
    expect(fit.verdict).not.toBe("ok");
    expect(fit.reasons).toContain("Species pH range is unknown.");
  });

  it("Fish Finder: a global entry's display pH default is not used as data", () => {
    const entry = toCatalogEntry(NO_CARE_FISH);
    // The card projection still carries the legacy display default...
    expect([entry.minPh, entry.maxPh]).toEqual([6.5, 7.5]);
    // ...but the honest ranges are null and the fit is a data gap, not a pass.
    expect(entryCareRanges(entry)).toEqual({ tempRange: null, phRange: null });
    const fit = assessSpeciesFit(entry, tank);
    expect(fit.verdict).toBe("caution");
    expect(fitPresentationKind(fit)).toBe("caution_data");
    expect(fit.reasons.join(" ")).toMatch(/confirmed pH range/);
  });

  it("the BreedGallery parameter check reads unknown, not within limits", () => {
    const entry = toCatalogEntry(NO_CARE_FISH);
    expect(checkRange(tank.ph, entryCareRanges(entry).phRange)).toBe("unknown");
    expect(checkRange(tank.temp, entryCareRanges(entry).tempRange)).toBe("unknown");
    const real = toCatalogEntry(REAL_FISH);
    expect(checkRange(7.5, entryCareRanges(real).phRange)).toBe("pass");
  });

  it("on-chain entries: real flat ranges count, 0 / 0 means unset", () => {
    expect(entryCareRanges({ minTemp: 22, maxTemp: 26, minPh: 6, maxPh: 7 }))
      .toEqual({ tempRange: [22, 26], phRange: [6, 7] });
    expect(entryCareRanges({ minTemp: 0, maxTemp: 0, minPh: 0, maxPh: 0 }))
      .toEqual({ tempRange: null, phRange: null });
  });

  it("logbook tank ranking never ranks a no-data species as ok", () => {
    const fishbaseData = [normalizeSpeciesRecord({ ...NO_CARE_FISH, speciesId: 910001 })];
    const profile = deriveSpeciesProfile({ speciesId: 910001 }, fishbaseData, []);
    const ranked = rankCompatibleTanks(profile, [
      { id: 1, volumeLiters: 150, tankType: 0, latestLog: { temp: 24, ph: 7 } },
    ]);
    expect(ranked[0].verdict).toBe("caution");
  });
});

// ─── Filters ─────────────────────────────────────────────────────────────────

describe("filters: missing data never matches a range filter", () => {
  it("range facets see no range for a no-data entry or record", () => {
    expect(recordedCareRanges(toCatalogEntry(NO_CARE_FISH))).toEqual({ tempRange: null, phRange: null });
    expect(recordedCareRanges(normalizeSpeciesRecord(NO_CARE_FISH))).toEqual({ tempRange: null, phRange: null });
    expect(recordedCareRanges(null)).toEqual({ tempRange: null, phRange: null });
  });

  it("a lone temperature ceiling is not widened into a range", () => {
    const r = recordedCareRanges({ ecology: { tempCeiling: 28 } });
    expect(r.tempRange).toBeNull();
  });

  it("real ranges still reach the facets", () => {
    expect(recordedCareRanges(toCatalogEntry(REAL_FISH))).toEqual({ tempRange: [20, 28], phRange: [7, 8] });
    expect(recordedCareRanges(normalizeSpeciesRecord(METRICS_ONLY_FISH))).toEqual({ tempRange: [20, 25], phRange: [6, 7] });
  });

  it("Finder intents exclude a species with no social or temperature data", () => {
    const fishbaseData = MISSING.map(normalizeSpeciesRecord);
    for (const rec of fishbaseData) {
      const entry = { scientificName: rec.scientificName };
      expect(speciesMatchesIntent(entry, "peaceful", { fishbaseData })).toBe(false);
      expect(speciesMatchesIntent(entry, "coldwater", { fishbaseData })).toBe(false);
    }
  });
});

// ─── Display, Poseidon context, listing drafts ───────────────────────────────

describe("display helpers show nothing invented", () => {
  it("care guide: no pH chip, no placeholder tip", () => {
    const fishbaseData = [
      normalizeSpeciesRecord({ ...NO_CARE_FISH, speciesId: 910001 }),
      normalizeSpeciesRecord({ ...PLACEHOLDER_FISH, speciesId: 910002 }),
    ];
    for (const id of [910001, 910002]) {
      const care = getSpeciesCare({ speciesId: id }, fishbaseData, []);
      expect(care.phMin).toBeUndefined();
      expect(care.phMax).toBeUndefined();
      expect(care.tempMax).toBeUndefined();
      expect(care.tip).toBeNull();
    }
  });

  it("care guide still shows derived real pH", () => {
    const fishbaseData = [normalizeSpeciesRecord({ ...METRICS_ONLY_FISH, speciesId: 910003 })];
    const care = getSpeciesCare({ speciesId: 910003 }, fishbaseData, []);
    expect([care.phMin, care.phMax]).toEqual([6, 7]);
  });

  it("formatCareRange hides a half-known range and CARE_NOT_RECORDED is plain", () => {
    expect(formatCareRange(6, null)).toBeNull();
    expect(formatCareRange(6.5, 7.5)).toBe("6.5 - 7.5");
    expect(CARE_NOT_RECORDED).toBe("Not recorded");
  });

  it("reef narration context omits unknown lines instead of 'no data'", () => {
    const text = reefSpeciesFactLines(normalizeSpeciesRecord(PLACEHOLDER_FISH));
    expect(text).not.toMatch(/no data|unknown|\?/i);
    expect(text).not.toMatch(PLACEHOLDER_RE);
    expect(text).not.toMatch(/Family:|Ecology:|Social:|Breeding:/);
    expect(text).toMatch(/^- Max length: 5 cm$/m);
    expect(reefSpeciesFactLines(normalizeSpeciesRecord(REAL_FISH))).toMatch(/- Social: Highly territorial/);
  });
});

describe("Poseidon species context", () => {
  it("omits missing family, ranges, social and biotope instead of '?' / 'N/A'", () => {
    for (const record of MISSING) {
      const text = formatSpeciesForContext(normalizeSpeciesRecord(record));
      expect(text).not.toMatch(/N\/A|\?/);
      expect(text).not.toMatch(/Family:|Temperature:|pH:|Social:|Biotope:|Breeding:/);
      expect(text).not.toMatch(PLACEHOLDER_RE);
    }
  });

  it("keeps recorded facts", () => {
    const text = formatSpeciesForContext(normalizeSpeciesRecord(REAL_FISH));
    expect(text).toMatch(/Family: Cichlidae/);
    expect(text).toMatch(/Temperature: 20–28°C \| pH: 7–8 \| Difficulty: Beginner/);
    expect(text).toMatch(/- Social: Highly territorial/);
    expect(text).toMatch(/- Breeding: Cave spawners/);
  });
});

describe("listing drafts", () => {
  it("no origin line for a missing or placeholder biotope", () => {
    for (const record of [...MISSING, PLACEHOLDER_FISH]) {
      const draft = buildListingDraftFromSpecies(normalizeSpeciesRecord(record));
      expect(draft.groundingFacts.origin).toBeNull();
      expect(draft.care.phRange).toBeNull();
      expect(draft.care.dataConfidence.phRange).toBe(false);
    }
    // Even an un-normalized stale record with the placeholder string.
    const stale = buildListingDraftFromSpecies({ ecology: { biotope: "Generic Biotope Details" } });
    expect(stale.groundingFacts.origin).toBeNull();
  });

  it("keeps a recorded biotope as the origin", () => {
    const draft = buildListingDraftFromSpecies(normalizeSpeciesRecord(REAL_FISH));
    expect(draft.groundingFacts.origin).toBe(REAL_FISH.ecology.biotope);
  });
});

// ─── Seed defaults baked into the data ───────────────────────────────────────

describe("the catalog carries no seed-script defaults", () => {
  it("no record stores the old default hardness or 'No data available.'", () => {
    const text = JSON.stringify(CATALOG);
    expect(text).not.toMatch(/"5 - 15 dGH"/);
    expect(text).not.toMatch(/"No data available\.?"/);
    expect(text).not.toMatch(PLACEHOLDER_RE);
  });

  it("real hardness values are kept", () => {
    const withHardness = CATALOG.filter((r) => r.ecology?.hardnessRange);
    expect(withHardness.length).toBeGreaterThan(0);
    expect(withHardness.some((r) => /dGH/.test(r.ecology.hardnessRange))).toBe(true);
  });

  it("the seed script writes null, never a default", () => {
    const seed = readFileSync(fileURLToPath(new URL("../../../scripts/seed_from_collectr.js", import.meta.url)), "utf8");
    expect(seed).not.toMatch(/\|\|\s*"(5 - 15 dGH|Omnivore|Information arriving soon|Generic Biotope Details)"/);
  });
});

describe("compatibility lookups resolve duplicate catalog IDs", () => {
  it("a fish saved under 70002 gets 12370's profile", () => {
    const catalog = CATALOG.map(normalizeSpeciesRecord);
    const old = deriveSpeciesProfile({ speciesId: 70002 }, catalog, []);
    const current = deriveSpeciesProfile({ speciesId: 12370 }, catalog, []);
    // Same care data; only the caller's own speciesId differs.
    const { speciesId: _a, ...oldCare } = old;
    const { speciesId: _b, ...currentCare } = current;
    expect(oldCare).toEqual(currentCare);
    expect(current.tempRange || current.phRange || current.minVolumeGallons).toBeTruthy();
  });
});
