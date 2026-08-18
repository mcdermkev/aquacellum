/**
 * sexingGuide.test.js
 *
 * Pins the three-state classification, the refusal to infer anything, and the
 * lockstep between the ESM module and the /js/sexing-guide.js browser mirror the
 * static database page loads.
 *
 * The fixtures at the top are VERBATIM from frontend/public/fishbase_master.json,
 * including the two shapes that matter most: the Convict Cichlid
 * (`identifiable: true`) and the Oscar (`identifiable: false` with prose that
 * explains you cannot sex it by eye). If the catalog's block shape ever changes,
 * these stop matching reality and should be re-copied from the data.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  SEXING_STATUS,
  SEXING_FILTER_OPTIONS,
  normalizeSexingGuide,
  sexingLabel,
  sexingBlurb,
  sexingShortLabel,
  hasSexingNotes,
  matchesSexingFilter,
  findCatalogRecord,
  sexingGuideForSpecies,
} from "./sexingGuide.js";

// ─── Fixtures copied from the real catalog ───────────────────────────────────

const CONVICT = {
  commonName: "Convict Cichlid",
  sexualDimorphism: {
    identifiable: true,
    male: "Larger overall size, more pointed dorsal and anal fin extensions, and typically less intense coloration.",
    female: "Smaller, with a distinctive orange-gold patch on the belly, especially vivid when guarding eggs/fry.",
    maturityAge: "4-6 months",
  },
};

const OSCAR = {
  commonName: "Oscar",
  sexualDimorphism: {
    identifiable: false,
    male: "No reliable external dimorphism; some mature males develop slightly more pointed dorsal/anal fin extensions.",
    female: "No reliable external dimorphism; sexing generally requires examining the genital papilla during breeding condition.",
    maturityAge: "12-24 months depending on growth rate",
  },
};

/** 296 of 316 catalog records look like this: no block at all. */
const PLAIN = { commonName: "Rosy Barb" };

describe("the three states", () => {
  it("identifiable: true is the only way to earn 'reliable'", () => {
    const guide = normalizeSexingGuide(CONVICT);
    expect(guide.status).toBe(SEXING_STATUS.RELIABLE);
    expect(guide.reliable).toBe(true);
    expect(guide.documented).toBe(true);
  });

  it("keeps an identifiable: false species DOCUMENTED rather than empty", () => {
    // THE POINT OF THIS MODULE. "You cannot sex this by eye, here is what you
    // would actually have to do" is an answer, not a gap. Collapsing it into
    // undocumented would discard the most useful thing we can tell a keeper
    // about an Oscar, and would read as "no differences exist".
    const guide = normalizeSexingGuide(OSCAR);
    expect(guide.status).toBe(SEXING_STATUS.UNRELIABLE);
    expect(guide.documented).toBe(true);
    expect(guide.reliable).toBe(false);
    expect(guide.male).toContain("No reliable external dimorphism");
    expect(guide.female).toContain("genital papilla");
  });

  it("reports undocumented for a record with no block", () => {
    const guide = normalizeSexingGuide(PLAIN);
    expect(guide.status).toBe(SEXING_STATUS.UNDOCUMENTED);
    expect(guide.documented).toBe(false);
    expect(guide.hasNotes).toBe(false);
  });

  it("never returns null, so no caller can silently render nothing", () => {
    for (const input of [null, undefined, {}, 42, "nope"]) {
      const guide = normalizeSexingGuide(input);
      expect(guide).toBeTruthy();
      expect(guide.status).toBe(SEXING_STATUS.UNDOCUMENTED);
    }
  });
});

describe("it refuses to invent reliability", () => {
  it("treats a block with prose but no identifiable flag as unreliable, not reliable", () => {
    // Someone wrote the notes and never made the reliability call. The safe
    // reading of "unknown reliability" is not to promise the keeper it works.
    const guide = normalizeSexingGuide({
      sexualDimorphism: { male: "Brighter.", female: "Duller." },
    });
    expect(guide.status).toBe(SEXING_STATUS.UNRELIABLE);
  });

  it("does not accept a truthy-but-not-true identifiable", () => {
    for (const flag of ["true", 1, {}, "yes"]) {
      const guide = normalizeSexingGuide({
        sexualDimorphism: { identifiable: flag, male: "a", female: "b" },
      });
      expect(guide.status, String(flag)).toBe(SEXING_STATUS.UNRELIABLE);
    }
  });

  it("downgrades a flag-only block with no prose to undocumented", () => {
    const guide = normalizeSexingGuide({ sexualDimorphism: { identifiable: true } });
    expect(guide.status).toBe(SEXING_STATUS.UNDOCUMENTED);
    expect(guide.hasNotes).toBe(false);
  });
});

describe("catalog placeholders are not documentation", () => {
  it("rejects 'Information arriving soon', which useSpeciesData backfills", () => {
    // hooks/useSpeciesData.js fills absent rich fields with this string. Letting
    // it through would render "Male: Information arriving soon" and claim
    // documentation that does not exist.
    const guide = normalizeSexingGuide({
      sexualDimorphism: {
        identifiable: true,
        male: "Information arriving soon",
        female: "  ",
        maturityAge: "N/A",
      },
    });
    expect(guide.status).toBe(SEXING_STATUS.UNDOCUMENTED);
    expect(guide.male).toBeNull();
    expect(guide.female).toBeNull();
    expect(guide.maturityAge).toBeNull();
  });
});

describe("structured cues are read but never derived", () => {
  it("is empty for every record shipping today", () => {
    expect(normalizeSexingGuide(CONVICT).cues).toEqual([]);
    // And it does NOT try to parse the prose into traits.
    expect(normalizeSexingGuide(CONVICT).male).toBeTruthy();
  });

  it("reads a supplied cue list", () => {
    const guide = normalizeSexingGuide({
      sexualDimorphism: {
        identifiable: true,
        cues: [{ trait: "Dorsal fin", male: "Pointed", female: "Rounded" }],
      },
    });
    expect(guide.status).toBe(SEXING_STATUS.RELIABLE);
    expect(guide.cues).toEqual([{ trait: "Dorsal fin", male: "Pointed", female: "Rounded" }]);
    expect(guide.hasNotes).toBe(true);
  });

  it("drops a cue that names a trait but describes neither sex", () => {
    const guide = normalizeSexingGuide({
      sexualDimorphism: {
        identifiable: true,
        male: "Bigger.",
        cues: [{ trait: "Colour" }, { trait: "", male: "x" }, null, { trait: "Size", female: "Rounder" }],
      },
    });
    expect(guide.cues).toEqual([{ trait: "Size", male: null, female: "Rounder" }]);
  });
});

describe("copy", () => {
  it("has a distinct label for each state in both modes", () => {
    const labels = new Set();
    for (const record of [CONVICT, OSCAR, PLAIN]) {
      const guide = normalizeSexingGuide(record);
      labels.add(sexingLabel(guide));
      labels.add(sexingLabel(guide, { casual: true }));
      expect(sexingBlurb(guide)).toBeTruthy();
      expect(sexingBlurb(guide, { casual: true })).toBeTruthy();
    }
    expect(labels.size).toBe(6);
  });

  it("has a distinct short badge label per state, short enough for a card", () => {
    const shorts = [CONVICT, OSCAR, PLAIN].map((r) => sexingShortLabel(normalizeSexingGuide(r)));
    expect(new Set(shorts).size).toBe(3);
    for (const s of shorts) expect(s.length).toBeLessThanOrEqual(16);
  });

  it("casual copy never says 'specimen'", () => {
    // finderCopy's off-vocabulary rule for casual surfaces.
    for (const record of [CONVICT, OSCAR, PLAIN]) {
      const guide = normalizeSexingGuide(record);
      expect(sexingLabel(guide, { casual: true }).toLowerCase()).not.toContain("specimen");
      expect(sexingBlurb(guide, { casual: true }).toLowerCase()).not.toContain("specimen");
    }
  });

  it("never claims certainty for the unreliable state", () => {
    const guide = normalizeSexingGuide(OSCAR);
    const blurb = `${sexingBlurb(guide)} ${sexingBlurb(guide, { casual: true })}`.toLowerCase();
    expect(blurb).toMatch(/guess|subtle|unreliable/);
  });
});

describe("hasSexingNotes", () => {
  it("is true for both documented states and false otherwise", () => {
    expect(hasSexingNotes(normalizeSexingGuide(CONVICT))).toBe(true);
    expect(hasSexingNotes(normalizeSexingGuide(OSCAR))).toBe(true);
    expect(hasSexingNotes(normalizeSexingGuide(PLAIN))).toBe(false);
    expect(hasSexingNotes(null)).toBe(false);
  });
});

describe("the catalog filter", () => {
  const records = [CONVICT, OSCAR, PLAIN];
  const names = (mode) => records.filter((r) => matchesSexingFilter(r, mode)).map((r) => r.commonName);

  it("passes everything for 'any' or a missing mode", () => {
    expect(names("any")).toHaveLength(3);
    expect(names(undefined)).toHaveLength(3);
    expect(names("nonsense")).toHaveLength(3);
  });

  it("'reliable' returns only the by-eye species", () => {
    expect(names("reliable")).toEqual(["Convict Cichlid"]);
  });

  it("'documented' INCLUDES the not-visually-sexable species", () => {
    // Someone filtering for "sexing we have written up" wants the Oscar entry
    // that says you cannot do it by eye — that is a documented answer.
    expect(names("documented")).toEqual(["Convict Cichlid", "Oscar"]);
  });

  it("'undocumented' finds the gaps, which is the contribution queue", () => {
    expect(names("undocumented")).toEqual(["Rosy Barb"]);
  });

  it("exposes every filter mode as an option", () => {
    const values = SEXING_FILTER_OPTIONS.map((o) => o.value);
    expect(values).toEqual(["any", "reliable", "documented", "undocumented"]);
    for (const o of SEXING_FILTER_OPTIONS) expect(o.label).toBeTruthy();
  });
});

describe("resolving a species reference to its record", () => {
  const RECORDS = [
    { specCode: 3615, scientificName: "Amatitlania nigrofasciata", commonName: "Convict Cichlid", sexualDimorphism: CONVICT.sexualDimorphism },
    { specCode: 2, scientificName: "Astronotus ocellatus", commonName: "Oscar", sexualDimorphism: OSCAR.sexualDimorphism },
    { specCode: 3, scientificName: "Puntius conchonius", commonName: "Rosy Barb" },
  ];

  it("matches on scientific name, case- and space-insensitively", () => {
    expect(findCatalogRecord(RECORDS, { scientificName: "  amatitlania NIGROFASCIATA " }).commonName)
      .toBe("Convict Cichlid");
  });

  it("falls back to common name", () => {
    expect(findCatalogRecord(RECORDS, { commonName: "oscar" }).specCode).toBe(2);
  });

  it("NEVER matches an on-chain speciesId against a specCode", () => {
    // The whole point of the warning in the resolver. A contract catalog entry
    // with speciesId 2 must not silently resolve to the record whose specCode is
    // 2 — those are different numbering schemes that only coincide positionally,
    // and a false hit shows one fish's sexing notes under another fish's name.
    expect(findCatalogRecord(RECORDS, { speciesId: 2 })).toBeNull();
    expect(findCatalogRecord(RECORDS, { speciesId: 3615 })).toBeNull();
    // A real specCode still works, because that is like-for-like.
    expect(findCatalogRecord(RECORDS, { specCode: 3615 }).commonName).toBe("Convict Cichlid");
  });

  it("prefers the scientific name over a conflicting specCode", () => {
    const hit = findCatalogRecord(RECORDS, { scientificName: "Astronotus ocellatus", specCode: 3615 });
    expect(hit.commonName).toBe("Oscar");
  });

  it("returns a guide for a reference it cannot resolve rather than throwing", () => {
    for (const ref of [null, undefined, {}, { scientificName: "Nope nope" }]) {
      expect(sexingGuideForSpecies(RECORDS, ref).status).toBe(SEXING_STATUS.UNDOCUMENTED);
    }
    expect(sexingGuideForSpecies([], { scientificName: "Oscar" }).status).toBe(SEXING_STATUS.UNDOCUMENTED);
    expect(sexingGuideForSpecies(null, null).status).toBe(SEXING_STATUS.UNDOCUMENTED);
  });

  it("resolves through to the right guide", () => {
    expect(sexingGuideForSpecies(RECORDS, { scientificName: "Amatitlania nigrofasciata" }).status)
      .toBe(SEXING_STATUS.RELIABLE);
    expect(sexingGuideForSpecies(RECORDS, { commonName: "Oscar" }).status)
      .toBe(SEXING_STATUS.UNRELIABLE);
    expect(sexingGuideForSpecies(RECORDS, { commonName: "Rosy Barb" }).status)
      .toBe(SEXING_STATUS.UNDOCUMENTED);
  });
});

describe("the real catalog still matches the shape this module reads", () => {
  const catalog = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../public/fishbase_master.json", import.meta.url)), "utf8")
  );

  it("classifies every record without throwing", () => {
    for (const record of catalog) expect(normalizeSexingGuide(record).status).toBeTruthy();
  });

  it("finds the documented species the data actually has", () => {
    const documented = catalog.filter((r) => normalizeSexingGuide(r).documented);
    const reliable = catalog.filter((r) => normalizeSexingGuide(r).reliable);

    // 20 blocks today, 13 of them identifiable. Asserted as floors, not equality,
    // so backfilling more species is not a test failure — but silently LOSING
    // the data is.
    expect(documented.length).toBeGreaterThanOrEqual(20);
    expect(reliable.length).toBeGreaterThanOrEqual(13);
    expect(reliable.length).toBeLessThan(documented.length);
  });

  it("every documented record yields prose for at least one sex", () => {
    for (const record of catalog) {
      const guide = normalizeSexingGuide(record);
      if (!guide.documented) continue;
      expect(Boolean(guide.male || guide.female || guide.cues.length), record.commonName).toBe(true);
    }
  });
});

describe("public browser mirror stays in lockstep with the module", () => {
  // database.html cannot import ESM from src/, so it loads /js/sexing-guide.js as
  // a <script>. This evaluates that same file through its real global-assignment
  // path and asserts it agrees, so the public page and the app can never disagree
  // about whether a fish is sexable by eye.
  let mirror;
  try {
    const src = readFileSync(
      fileURLToPath(new URL("../../public/js/sexing-guide.js", import.meta.url)),
      "utf8"
    );
    const fakeRoot = {};
    const mod = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function("module", "window", "globalThis", src)(mod, fakeRoot, fakeRoot);
    mirror = mod.exports?.normalizeSexingGuide ? mod.exports : fakeRoot.SexingGuide;
  } catch {
    mirror = null;
  }

  const CASES = [
    CONVICT,
    OSCAR,
    PLAIN,
    null,
    undefined,
    {},
    { sexualDimorphism: {} },
    { sexualDimorphism: { identifiable: true } },
    { sexualDimorphism: { identifiable: "true", male: "a" } },
    { sexualDimorphism: { male: "Information arriving soon", female: "  " } },
    { sexualDimorphism: { identifiable: true, cues: [{ trait: "Fin", male: "Long" }] } },
    { sexualDimorphism: { identifiable: false, female: "Rounder", maturityAge: "6 months" } },
  ];

  it("exposes the mirror module", () => {
    expect(mirror, "frontend/public/js/sexing-guide.js should be require-able").toBeTruthy();
  });

  it("agrees on classification for every case", () => {
    if (!mirror) return;
    for (const record of CASES) {
      const m = mirror.normalizeSexingGuide(record);
      const c = normalizeSexingGuide(record);
      const where = JSON.stringify(record);
      expect(m.status, where).toBe(c.status);
      expect(m.documented, where).toBe(c.documented);
      expect(m.reliable, where).toBe(c.reliable);
      expect(m.badgeClass, where).toBe(c.badgeClass);
      expect(m.order, where).toBe(c.order);
      expect(m.male, where).toBe(c.male);
      expect(m.female, where).toBe(c.female);
      expect(m.maturityAge, where).toBe(c.maturityAge);
      expect(m.hasNotes, where).toBe(c.hasNotes);
      expect(m.cues, where).toEqual(c.cues);
    }
  });

  it("agrees on labels and blurbs in both modes", () => {
    if (!mirror) return;
    for (const record of CASES) {
      const m = mirror.normalizeSexingGuide(record);
      const c = normalizeSexingGuide(record);
      expect(mirror.sexingShortLabel(m)).toBe(sexingShortLabel(c));
      for (const casual of [false, true]) {
        expect(mirror.sexingLabel(m, { casual })).toBe(sexingLabel(c, { casual }));
        expect(mirror.sexingBlurb(m, { casual })).toBe(sexingBlurb(c, { casual }));
      }
    }
  });

  it("agrees on the filter for every mode", () => {
    if (!mirror) return;
    for (const mode of ["any", "reliable", "documented", "undocumented", undefined]) {
      for (const record of CASES) {
        expect(mirror.matchesSexingFilter(record, mode)).toBe(matchesSexingFilter(record, mode));
      }
    }
  });

  it("agrees on the symbols and filter options the page renders", () => {
    if (!mirror) return;
    expect(mirror.MALE_SYMBOL).toBe("♂");
    expect(mirror.FEMALE_SYMBOL).toBe("♀");
    expect(mirror.SEXING_FILTER_OPTIONS).toEqual(SEXING_FILTER_OPTIONS.map((o) => ({ ...o })));
  });
});
