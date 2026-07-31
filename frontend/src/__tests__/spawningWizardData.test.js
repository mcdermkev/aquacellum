/**
 * The Spawning wizard's local-first reads (docs/BREEDER_STATE_MODEL.md §9.12).
 *
 * `loadWizardData` used to rebuild the species catalog, the sire/dam pool, and
 * every tank's water snapshot from the RPC on each mount — including `ownerOf` +
 * `specimens` for every token ever minted. All three answers were already in
 * IndexedDB.
 *
 * Two things are asserted here, and the second is the one that matters:
 *
 *   1. The RPC calls are gone and named local reads stand in their place. Each
 *      absence is paired with the presence of its replacement, because an
 *      absence-only assertion also passes on a file that does nothing.
 *   2. A gap stays a gap. An unnamed species gets NO catalog entry so the label
 *      falls back to its id, and an unrecorded water parameter comes back null,
 *      never 0 — 0.00 ppm ammonia reads as a clean tank and would be printed onto
 *      the offspring's certificate.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Fakes ──────────────────────────────────────────────────────────────────

let speciesRows = [];
let manifestRows = [];
let tankRows = [];
let readingRows = [];
/** Table names that should behave as absent (older local databases). */
let missingTables = new Set();

function tableGuard(name) {
  if (missingTables.has(name)) throw new Error(`${name} table is not present`);
}

const asArray = (name, rows) => ({
  toArray: async () => {
    tableGuard(name);
    return rows();
  },
});

vi.mock("../db", () => ({
  db: {
    table: (name) => {
      if (name === "species") return asArray("species", () => speciesRows);
      throw new Error(`unexpected table ${name}`);
    },
    speciesManifest: asArray("speciesManifest", () => manifestRows),
    tanks: {
      where: (index) => ({
        equals: (value) => ({
          toArray: async () => {
            tableGuard("tanks");
            return tankRows.filter((t) => t[index] === value);
          },
        }),
      }),
    },
    paramReadings: {
      where: (index) => ({
        anyOf: (keys) => ({
          toArray: async () => {
            tableGuard("paramReadings");
            return readingRows.filter((r) =>
              keys.some((k) => String(k) === String(r[index]))
            );
          },
        }),
      }),
    },
  },
}));

const {
  loadLocalSpeciesCatalog,
  enrichSpeciesCatalogFromSpecimens,
  parameterSnapshotFromLog,
  loadLocalBreedingTanks,
} = await import("../services/spawningWizardData");

beforeEach(() => {
  speciesRows = [];
  manifestRows = [];
  tankRows = [];
  readingRows = [];
  missingTables = new Set();
});

// ─── Species catalog ────────────────────────────────────────────────────────

describe("loadLocalSpeciesCatalog", () => {
  it("reads db.species then fills gaps from db.speciesManifest", async () => {
    speciesRows = [{ speciesId: 1, commonName: "Neon Tetra", scientificName: "Paracheirodon innesi" }];
    manifestRows = [
      { speciesId: 1, commonName: "STALE MANIFEST NAME", scientificName: "stale" },
      { speciesId: 2, commonName: "Convict Cichlid", scientificName: "Amatitlania nigrofasciata" },
    ];

    const catalog = await loadLocalSpeciesCatalog();

    // First source wins for an id both cover.
    expect(catalog[1]).toEqual({ commonName: "Neon Tetra", scientificName: "Paracheirodon innesi" });
    expect(catalog[2]).toEqual({
      commonName: "Convict Cichlid",
      scientificName: "Amatitlania nigrofasciata",
    });
  });

  it("records no entry for a species with no name, so the caller's id fallback shows", async () => {
    speciesRows = [
      { speciesId: 3, commonName: "", scientificName: "   " },
      { speciesId: 4, commonName: "Guppy" },
    ];

    const catalog = await loadLocalSpeciesCatalog();

    // An empty-string entry would render as a blank where a name belongs.
    expect(catalog[3]).toBeUndefined();
    expect(catalog[4]).toEqual({ commonName: "Guppy", scientificName: "" });
  });

  it("skips rows whose id is not a usable species id", async () => {
    speciesRows = [
      { specCode: "BETTA-SPL", commonName: "Betta" },
      { speciesId: 0, commonName: "Zero" },
      { speciesId: -2, commonName: "Negative" },
    ];

    expect(await loadLocalSpeciesCatalog()).toEqual({});
  });

  it("keeps the source it can read when the other table is absent", async () => {
    missingTables = new Set(["species"]);
    manifestRows = [{ speciesId: 7, commonName: "Corydoras" }];

    expect(await loadLocalSpeciesCatalog()).toEqual({
      7: { commonName: "Corydoras", scientificName: "" },
    });
  });

  it("returns an empty catalog rather than throwing when nothing is local", async () => {
    missingTables = new Set(["species", "speciesManifest"]);
    expect(await loadLocalSpeciesCatalog()).toEqual({});
  });
});

describe("enrichSpeciesCatalogFromSpecimens", () => {
  it("fills only the ids the tables missed, and never overwrites them", () => {
    const catalog = { 1: { commonName: "Neon Tetra", scientificName: "Paracheirodon innesi" } };
    const merged = enrichSpeciesCatalogFromSpecimens(catalog, [
      { speciesId: 1, commonName: "Nickname From A Certificate" },
      { speciesId: 5, commonName: "Endler", scientificName: "Poecilia wingei" },
    ]);

    expect(merged[1].commonName).toBe("Neon Tetra");
    expect(merged[5]).toEqual({ commonName: "Endler", scientificName: "Poecilia wingei" });
    // The input catalog is left alone.
    expect(catalog[5]).toBeUndefined();
  });

  it("invents nothing for a certificate that carries no species name", () => {
    const merged = enrichSpeciesCatalogFromSpecimens({}, [
      { speciesId: 9, commonName: "", scientificName: "" },
    ]);
    expect(merged).toEqual({});
  });

  it("tolerates a null catalog and a null specimen list", () => {
    expect(enrichSpeciesCatalogFromSpecimens(null, null)).toEqual({});
  });
});

// ─── Water snapshot ─────────────────────────────────────────────────────────

describe("parameterSnapshotFromLog", () => {
  it("reproduces the fixed-point conversion the wizard used to do inline", () => {
    expect(
      parameterSnapshotFromLog({
        tempCelsiusX10: 246,
        phX10: 72,
        ammoniaPpmX100: 0,
        nitritePpmX100: 0,
        nitratePpmX100: 500,
        timestamp: 1700000000,
      })
    ).toEqual({
      temp: "24.6",
      ph: "7.2",
      // A MEASURED zero is a real reading and stays 0.00.
      ammonia: "0.00",
      nitrite: "0.00",
      nitrate: "5.0",
      timestamp: 1700000000,
    });
  });

  it("reads a decimal paramReadings row too", () => {
    expect(
      parameterSnapshotFromLog({
        temp: 25,
        ph: 6.8,
        ammonia: 0.25,
        nitrite: 0,
        nitrate: 12.4,
        timestamp: 500,
      })
    ).toEqual({
      temp: "25.0",
      ph: "6.8",
      ammonia: "0.25",
      nitrite: "0.00",
      nitrate: "12.4",
      timestamp: 500,
    });
  });

  it("reports an unrecorded parameter as null, not as zero", () => {
    // The v23 backfill seeds temp/pH only, so a partial row is the normal case.
    const snapshot = parameterSnapshotFromLog({ tankId: 7, timestamp: 300, temp: 24.5, ph: 7.2 });
    expect(snapshot).toEqual({
      temp: "24.5",
      ph: "7.2",
      ammonia: null,
      nitrite: null,
      nitrate: null,
      timestamp: 300,
    });
  });

  it("treats a row with no parameters at all as no snapshot", () => {
    expect(parameterSnapshotFromLog({ tankId: 7, timestamp: 300, notes: "topped off" })).toBeNull();
    expect(parameterSnapshotFromLog(null)).toBeNull();
    expect(parameterSnapshotFromLog(undefined)).toBeNull();
  });

  it("rejects unparseable values instead of turning them into NaN", () => {
    const snapshot = parameterSnapshotFromLog({ temp: "not a number", ph: 7 });
    expect(snapshot.temp).toBeNull();
    expect(snapshot.ph).toBe("7.0");
  });

  it("reports a missing timestamp as null rather than 1970", () => {
    expect(parameterSnapshotFromLog({ temp: 24 }).timestamp).toBeNull();
  });
});

// ─── Tanks ──────────────────────────────────────────────────────────────────

describe("loadLocalBreedingTanks", () => {
  it("attaches the tank row's own latest log", async () => {
    tankRows = [
      {
        id: 10,
        ownerAddress: "0xabc",
        name: "Breeding Tank",
        volumeLiters: 75,
        latestLog: { tempCelsiusX10: 260, phX10: 68, timestamp: 99 },
      },
    ];

    const tanks = await loadLocalBreedingTanks("0xABC");

    expect(tanks).toHaveLength(1);
    expect(tanks[0]).toMatchObject({ id: 10, name: "Breeding Tank", volumeLiters: 75 });
    expect(tanks[0].latestReading).toMatchObject({ temp: "26.0", ph: "6.8", timestamp: 99 });
  });

  it("falls back to the last entry of the tank's log array", async () => {
    tankRows = [
      {
        id: 11,
        ownerAddress: "0xabc",
        name: "Grow-out",
        logs: [
          { tempCelsiusX10: 240, timestamp: 1 },
          { tempCelsiusX10: 250, timestamp: 2 },
        ],
      },
    ];

    const [tank] = await loadLocalBreedingTanks("0xabc");
    expect(tank.latestReading.temp).toBe("25.0");
  });

  it("consults paramReadings only when the tank row has no log, newest first", async () => {
    tankRows = [{ id: 12, ownerAddress: "0xabc", name: "Fry Tub" }];
    readingRows = [
      { tankId: 12, timestamp: 100, temp: 24.0, ph: 7.0 },
      { tankId: "12", timestamp: 400, temp: 26.2, ph: 6.6 },
      { tankId: 99, timestamp: 900, temp: 30.0 },
    ];

    const [tank] = await loadLocalBreedingTanks("0xabc");
    expect(tank.latestReading).toMatchObject({ temp: "26.2", ph: "6.6", timestamp: 400 });
    // Still honest about the three parameters no local record carries.
    expect(tank.latestReading.ammonia).toBeNull();
    expect(tank.latestReading.nitrate).toBeNull();
  });

  it("reports no reading rather than an invented one", async () => {
    tankRows = [{ id: 13, ownerAddress: "0xabc", name: "Quarantine" }];
    expect((await loadLocalBreedingTanks("0xabc"))[0].latestReading).toBeNull();

    missingTables = new Set(["paramReadings"]);
    expect((await loadLocalBreedingTanks("0xabc"))[0].latestReading).toBeNull();
  });

  it("keeps retired tanks out and returns an empty list as a real answer", async () => {
    tankRows = [
      { id: 14, ownerAddress: "0xabc", name: "Retired", active: false },
      { id: 15, ownerAddress: "0xother", name: "Someone else's" },
    ];
    expect(await loadLocalBreedingTanks("0xabc")).toEqual([]);
    // No signed-in account is not "every tank on the device".
    expect(await loadLocalBreedingTanks("")).toEqual([]);
    expect(await loadLocalBreedingTanks(null)).toEqual([]);
  });

  it("returns an empty list rather than throwing when tanks cannot be read", async () => {
    missingTables = new Set(["tanks"]);
    expect(await loadLocalBreedingTanks("0xabc")).toEqual([]);
  });
});

// ─── Source guards ──────────────────────────────────────────────────────────

describe("source guards", () => {
  /**
   * Comment-stripped source. Block, JSX, and line comments all go, so a guard
   * asserting an absence can't be satisfied — or broken — by prose that names the
   * call it removed.
   */
  function code(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  const WIZARD = code("../components/SpawningWizard.jsx");
  const SERVICE = code("../services/spawningWizardData.js");

  it("strips all three comment styles, or every absence below is vacuous", () => {
    // Each phrase below exists in the wizard in exactly one comment, of one of
    // the three kinds. A guard that names the call it removed — and these do —
    // would otherwise assert against its own prose.
    expect(WIZARD).not.toContain("registry sweep");              // line
    expect(WIZARD).not.toContain("ORDERS, NEVER FILTERS");       // block
    expect(WIZARD).not.toContain("RELATEDNESS CONNECTOR BADGE"); // JSX
    // …while the code around them survives.
    expect(WIZARD).toContain("setSpecimens(activeSpecimens)");
    expect(WIZARD).toContain("candidatesFor(selectedDamId)");
  });

  it("builds the species catalog from Dexie instead of one registry read per species", () => {
    expect(WIZARD).not.toContain("contract.speciesCatalog");
    expect(WIZARD).not.toContain("nextSpeciesId");
    expect(WIZARD).toContain("loadLocalSpeciesCatalog()");
    expect(WIZARD).toContain("enrichSpeciesCatalogFromSpecimens(catalog, activeSpecimens)");
  });

  it("resolves the sire/dam pool from Dexie instead of sweeping every minted token", () => {
    expect(WIZARD).not.toContain("totalSpecimensMinted");
    expect(WIZARD).not.toContain("contract.ownerOf");
    // A local serial is not a token id: contract.specimens(serial) returns a real
    // but WRONG fish, silently (BREEDER_STATE_MODEL §3, services/pedigree.js).
    expect(WIZARD).not.toContain("contract.specimens(");
    expect(WIZARD).toContain("db.specimens.where(\"ownerAddress\")");
    expect(WIZARD).toContain("db.tanks.where(\"ownerAddress\")");
  });

  it("still hides archived certificates from the parent pickers", () => {
    // §4.1 — asserted in specimenLifecycle.test.js too; repeated because this
    // change rewrote the loop the line lives in.
    expect(WIZARD).toContain("if (spec.archived) continue");
  });

  it("takes the water snapshot from local records, with no unbounded probe loops", () => {
    expect(WIZARD).not.toContain("tankParameterLogs");
    expect(WIZARD).not.toContain("ownerTanks");
    expect(WIZARD).not.toContain("while (true)");
    expect(WIZARD).toContain("loadLocalBreedingTanks(walletAccount)");
    expect(WIZARD).toContain("latestReading");
  });

  it("renders an unknown parameter as an em dash and omits it from the certificate", () => {
    expect(WIZARD).toContain("readingText(snappedParameters.temp");
    expect(WIZARD).toContain("readingText(snappedParameters.ammonia");
    expect(WIZARD).toContain("snappedTraits(snappedParameters)");
    // The old inline arithmetic would print "NaN ppm" for an unrecorded value.
    expect(WIZARD).not.toContain("ammoniaPpmX100");
    expect(WIZARD).not.toContain("tempCelsiusX10");
  });

  it("keeps the loading, error, and retry states", () => {
    expect(WIZARD).toContain("setLoading(true)");
    expect(WIZARD).toContain("setError(\"Failed to resolve registry data for spawning setup.\")");
    expect(WIZARD).toContain("onClick={loadWizardData}");
  });

  it("keeps the pairing assessment's contract, which is a genuine cross-account read", () => {
    // assessPairing → services/pedigree.js consults the chain ONLY for an
    // ancestor this browser has never mirrored, after Dexie comes up empty.
    expect(WIZARD).toContain("new Contract(contractAddress, aquadexAbi, getProvider())");
    expect(WIZARD).toContain("assessPairing");
  });

  it("gives the service no chain access at all", () => {
    expect(SERVICE).not.toContain("contract");
    expect(SERVICE).not.toContain("ethers");
    expect(SERVICE).not.toContain("getProvider");
    expect(SERVICE).toContain("import { db } from \"../db\"");
  });

  it("leaves the modules this change was not allowed to touch alone", () => {
    expect(SERVICE).not.toContain("relayMintSpecimen");
    expect(SERVICE).not.toContain("cohortPromotion");
    expect(SERVICE).not.toContain("pedigree");
  });
});
