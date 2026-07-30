/**
 * Cohort → certificate promotion (docs/BREEDER_STATE_MODEL.md §9.16,
 * docs/BREEDER_TOOLS_T2_PROMOTION_SPEC.md).
 *
 * The invariant every test here defends:
 *
 *   A fish is counted EITHER as a cohort head OR as an individual certificate.
 *   Never both. Never neither.
 *
 * The two ways to break it both fabricate fish rather than crashing, which is why
 * they are asserted on the STORES and not on the return value:
 *
 *   - promoting more than the cohort has alive
 *   - counting the number requested instead of the number that actually minted
 *
 * A rejected promotion must leave both `specimens` and `spawnGrowout` untouched.
 * "It returned an error" is not the criterion.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Fakes ──────────────────────────────────────────────────────────────────

const spawnRows = new Map();
/** Every `relayMintSpecimen` call, in order. */
const mintCalls = [];
/** Rows written to `spawnGrowout`. */
const growoutRows = [];
/** Cloud mirror calls. */
const cloudCalls = [];
/** XP awards. */
const xpCalls = [];
/**
 * Per-call mint outcome. `null` (default) → every call succeeds. An array is
 * consumed positionally: `false` makes that one call fail.
 */
let mintScript = null;
let nextSerial = 100;

vi.mock("../services/supabaseClient", () => ({
  isSupabaseConfigured: () => false,
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: "https://placeholder.supabase.co/x.json" } }),
        upload: async () => ({ error: null }),
      }),
    },
  },
}));

vi.mock("../db", () => ({
  db: {
    spawns: {
      get: async (id) => spawnRows.get(Number(id)) || spawnRows.get(id) || undefined,
      update: async (id, patch) => {
        const key = spawnRows.has(Number(id)) ? Number(id) : id;
        const row = spawnRows.get(key);
        if (row) spawnRows.set(key, { ...row, ...patch });
      },
    },
    spawnGrowout: {
      where: () => ({ equals: (spawnId) => ({ toArray: async () => checkpointsFor(spawnId) }) }),
      add: async (row) => {
        growoutRows.push(row);
        return growoutRows.length;
      },
    },
  },
}));

vi.mock("../services/relayer", () => ({
  relayMintSpecimen: async (args) => {
    const index = mintCalls.length;
    mintCalls.push(args);
    const ok = mintScript ? mintScript[index] !== false : true;
    if (!ok) return { success: false, error: "simulated mint failure" };
    nextSerial += 1;
    return { success: true, specimenId: nextSerial, txHash: null };
  },
}));

vi.mock("../services/cloudSync", () => ({
  syncGrowoutCheckpointToCloud: async (checkpoint, owner) => {
    cloudCalls.push({ checkpoint, owner });
  },
}));

vi.mock("../utils/xp", () => ({
  addXp: (points, label) => xpCalls.push({ points, label }),
  XP_ACTIONS: { MINT_SPECIMEN: { points: 50, label: "Registered Birth Certificate" } },
}));

const {
  promoteCohortToCertificates,
  promotableCount,
  PROMOTE_MAX_PER_ACTION,
  PROMOTED_TYPE,
} = await import("../services/cohortPromotion");
const { summarizeGrowout } = await import("../utils/growoutFunnel");

// ─── Fixture ────────────────────────────────────────────────────────────────

const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SPAWN_ID = 1731000123456;
const SPAWN_TIMESTAMP = 1730000000;

/** Seeded cohort history, plus whatever the module under test appends. */
let seededCheckpoints = [];

function checkpointsFor(spawnId) {
  return [...seededCheckpoints, ...growoutRows].filter((c) => c.spawnId === Number(spawnId));
}

function seedSpawn(overrides = {}) {
  spawnRows.set(SPAWN_ID, {
    spawnId: SPAWN_ID,
    sireId: 7,
    damId: 12,
    tankId: 3,
    speciesId: 42,
    status: 1,
    offspringIds: [55, 56],
    ownerAddress: OWNER,
    timestamp: SPAWN_TIMESTAMP,
    ...overrides,
  });
}

/** A cohort with `fry` counted and nothing departed yet. */
function seedCohort(fry) {
  seededCheckpoints = [
    { spawnId: SPAWN_ID, timestamp: SPAWN_TIMESTAMP + 10, type: "fry_count", count: fry },
  ];
}

const CATALOG = { 42: { commonName: "Neon Tetra", scientificName: "Paracheirodon innesi" } };

beforeEach(() => {
  spawnRows.clear();
  mintCalls.length = 0;
  growoutRows.length = 0;
  cloudCalls.length = 0;
  xpCalls.length = 0;
  seededCheckpoints = [];
  mintScript = null;
  nextSerial = 100;
  seedSpawn();
  seedCohort(12);
});

// ─── Provenance comes from the spawn, never from the caller ─────────────────

describe("promotion provenance", () => {
  it("creates one certificate per fish with the spawn's parents, tank, and hatch date", async () => {
    const result = await promoteCohortToCertificates({
      spawnId: SPAWN_ID,
      count: 3,
      speciesCatalog: CATALOG,
    });

    expect(result.success).toBe(true);
    expect(result.promoted).toBe(3);
    expect(result.specimenIds).toHaveLength(3);
    expect(mintCalls).toHaveLength(3);

    for (const call of mintCalls) {
      expect(call.sireId).toBe(7);
      expect(call.damId).toBe(12);
      expect(call.currentTankId).toBe(3);
      expect(call.speciesId).toBe(42);
      expect(call.ownerAddress).toBe(OWNER);
      expect(call.breeder).toBe(OWNER);
      // The fish was born when the spawn happened. Date.now() would stamp a false
      // hatch date onto a certificate that cannot be corrected later.
      expect(call.birthTimestamp).toBe(SPAWN_TIMESTAMP);
    }
  });

  it("never supplies an on-chain metadata URI — the relayer resolves it per serial", async () => {
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1, speciesCatalog: CATALOG });
    expect(mintCalls[0].ipfsMetadataUri).toBeUndefined();
    expect(mintCalls[0].metadataDocument).toBeTruthy();
  });

  it("records a self-describing origin on the certificate document", async () => {
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1, speciesCatalog: CATALOG });
    const attributes = mintCalls[0].metadataDocument.attributes;
    const byTrait = Object.fromEntries(attributes.map((a) => [a.trait_type, a.value]));

    expect(byTrait.Origin).toBe("Promoted from grow-out cohort");
    expect(byTrait["Source Spawn"]).toBe(String(SPAWN_ID));
    // Built through buildSpecimenMetadata, so the shared attributes are present.
    expect(byTrait["Sire ID"]).toBe("7");
    expect(byTrait["Dam ID"]).toBe("12");
  });

  it("defaults sex to Unsexed and passes a supplied sex through unchanged", async () => {
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 3, sexes: ["Female", "Not Sure"], speciesCatalog: CATALOG });
    expect(mintCalls[0].gender).toBe("Female");
    // Legacy vocabulary normalizes rather than persisting a fourth value.
    expect(mintCalls[1].gender).toBe("Unsexed");
    // Omitted entirely — an explicit unknown, not an inference.
    expect(mintCalls[2].gender).toBe("Unsexed");
  });

  it("appends the new serials to the spawn's existing offspringIds", async () => {
    const result = await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 2, speciesCatalog: CATALOG });
    expect(spawnRows.get(SPAWN_ID).offspringIds).toEqual([55, 56, ...result.specimenIds]);
  });
});

// ─── The hard block: nothing is written on rejection ────────────────────────

describe("over-promotion is blocked, and blocked means nothing is written", () => {
  it("refuses to promote more than the cohort has alive", async () => {
    seedCohort(15);
    seededCheckpoints.push({ spawnId: SPAWN_ID, timestamp: SPAWN_TIMESTAMP + 20, type: "loss", count: 11 });
    // 15 fry − 11 lost = 4 alive.
    const result = await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 6, speciesCatalog: CATALOG });

    expect(result.success).toBe(false);
    expect(result.error).toContain("4");
    // The part that matters: no fabricated fish, and no phantom departure.
    expect(mintCalls).toHaveLength(0);
    expect(growoutRows).toHaveLength(0);
  });

  it("refuses a count above the per-action cap without touching either store", async () => {
    seedCohort(500);
    const result = await promoteCohortToCertificates({
      spawnId: SPAWN_ID,
      count: PROMOTE_MAX_PER_ACTION + 1,
      speciesCatalog: CATALOG,
    });

    expect(result.success).toBe(false);
    expect(mintCalls).toHaveLength(0);
    expect(growoutRows).toHaveLength(0);
  });

  it("refuses a zero, negative, or fractional count", async () => {
    for (const count of [0, -3, 2.5, NaN, undefined]) {
      const result = await promoteCohortToCertificates({ spawnId: SPAWN_ID, count, speciesCatalog: CATALOG });
      expect(result.success, String(count)).toBe(false);
    }
    expect(mintCalls).toHaveLength(0);
    expect(growoutRows).toHaveLength(0);
  });

  it("refuses an empty cohort", async () => {
    seededCheckpoints = [];
    const result = await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1, speciesCatalog: CATALOG });
    expect(result.success).toBe(false);
    expect(mintCalls).toHaveLength(0);
  });
});

describe("unattributable spawns fail loudly rather than minting a wrong certificate", () => {
  it("fails on a missing spawn", async () => {
    const result = await promoteCohortToCertificates({ spawnId: 999999, count: 1, speciesCatalog: CATALOG });
    expect(result.success).toBe(false);
    expect(mintCalls).toHaveLength(0);
    expect(growoutRows).toHaveLength(0);
  });

  it("fails on a spawn with no ownerAddress instead of guessing a wallet", async () => {
    seedSpawn({ ownerAddress: "" });
    const result = await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1, speciesCatalog: CATALOG });
    expect(result.success).toBe(false);
    expect(mintCalls).toHaveLength(0);
  });

  it("never mints with an absent parent reference", async () => {
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 2, speciesCatalog: CATALOG });
    for (const call of mintCalls) {
      expect(call.sireId).toBeGreaterThan(0);
      expect(call.damId).toBeGreaterThan(0);
    }
  });
});

// ─── The checkpoint counts certificates, not intentions ────────────────────

describe("the checkpoint count is derived from successful mints", () => {
  it("logs one promoted checkpoint for the requested count when all succeed", async () => {
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 3, speciesCatalog: CATALOG });
    expect(growoutRows).toHaveLength(1);
    expect(growoutRows[0].type).toBe(PROMOTED_TYPE);
    expect(growoutRows[0].count).toBe(3);
  });

  it("logs 2, not 3, when the second of three mints fails", async () => {
    mintScript = [true, false, true];
    const result = await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 3, speciesCatalog: CATALOG });

    expect(result.promoted).toBe(2);
    expect(result.requested).toBe(3);
    expect(result.partial).toBe(true);
    expect(result.specimenIds).toHaveLength(2);
    expect(growoutRows).toHaveLength(1);
    // A checkpoint of 3 here would decrement the cohort for a fish that does not
    // exist — the exact failure this ordering prevents.
    expect(growoutRows[0].count).toBe(2);
  });

  it("writes no checkpoint at all when every mint fails", async () => {
    mintScript = [false, false];
    const result = await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 2, speciesCatalog: CATALOG });

    expect(result.success).toBe(false);
    expect(growoutRows).toHaveLength(0);
    // The cohort is unchanged, so its offspring list must be too.
    expect(spawnRows.get(SPAWN_ID).offspringIds).toEqual([55, 56]);
  });

  it("mirrors the checkpoint to the cloud with the spawn's owner", async () => {
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1, speciesCatalog: CATALOG });
    expect(cloudCalls).toHaveLength(1);
    expect(cloudCalls[0].owner).toBe(OWNER);
    expect(cloudCalls[0].checkpoint.type).toBe(PROMOTED_TYPE);
  });

  it("awards certificate XP once per action, not once per fish", async () => {
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 4, speciesCatalog: CATALOG });
    expect(xpCalls).toHaveLength(1);
  });
});

// ─── Two promotions in the same second must stay two events ────────────────

describe("checkpoint timestamps do not collide", () => {
  it("gives a second promotion in the same second a distinct timestamp", async () => {
    seedCohort(12);
    const first = await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 2, speciesCatalog: CATALOG });
    const second = await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 3, speciesCatalog: CATALOG });

    expect(first.success && second.success).toBe(true);
    expect(growoutRows).toHaveLength(2);
    // The cloud mirror's natural key is (owner, spawn, event_timestamp, type), so
    // an identical timestamp would upsert the two into one row and UNDERCOUNT the
    // departure — leaving the cohort holding heads that are already certificates.
    expect(growoutRows[0].timestamp).not.toBe(growoutRows[1].timestamp);

    // And the cohort decrements by the full combined count.
    const funnel = summarizeGrowout(checkpointsFor(SPAWN_ID));
    expect(funnel.promoted).toBe(5);
    expect(funnel.alive).toBe(7);
  });

  it("blocks the second promotion once the cohort is exhausted", async () => {
    seedCohort(4);
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 4, speciesCatalog: CATALOG });
    const second = await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1, speciesCatalog: CATALOG });

    expect(second.success).toBe(false);
    expect(growoutRows).toHaveLength(1);
    expect(mintCalls).toHaveLength(4);
  });
});

// ─── promotableCount is the one cap expression ─────────────────────────────

describe("promotableCount", () => {
  it("is the smaller of the living count and the per-action cap", () => {
    expect(promotableCount({ alive: 4 })).toBe(4);
    expect(promotableCount({ alive: 500 })).toBe(PROMOTE_MAX_PER_ACTION);
    expect(promotableCount({ alive: 0 })).toBe(0);
  });

  it("treats a missing or negative count as nothing promotable", () => {
    expect(promotableCount(undefined)).toBe(0);
    expect(promotableCount({})).toBe(0);
    expect(promotableCount({ alive: -5 })).toBe(0);
  });
});

// ─── Source guards ────────────────────────────────────────────────────────

describe("source guards", () => {
  function code(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  const SRC = code("../services/cohortPromotion.js");

  it("resolves ancestry through the spawn record, never through the contract", () => {
    // A local serial is not an on-chain token id: contract.specimens(serial)
    // returns a real but WRONG fish, silently (BREEDER_STATE_MODEL §3).
    expect(SRC).not.toContain("contract.specimens(");
    expect(SRC).not.toContain("ownerOf(");
  });

  it("exposes no delete path", () => {
    expect(SRC).not.toContain("db.specimens.delete");
    expect(SRC).not.toContain("db.spawnGrowout.delete");
  });

  it("passes no ipfsMetadataUri to the mint call", () => {
    expect(SRC).not.toContain("ipfsMetadataUri");
  });

  it("builds no metadata document of its own", () => {
    expect(SRC).toContain("buildSpecimenMetadata");
    expect(SRC).not.toMatch(/attributes:\s*\[/);
  });

  it("uses no Date.now() for the certificate's birth timestamp", () => {
    // Date.now() is used for the CHECKPOINT timestamp, which is correct — the
    // promotion happened now. The birth date must come from the spawn.
    expect(SRC).toMatch(/birthTimestamp:\s*Number\(spawn\.timestamp\)/);
  });

  it("is not entitlement-gated", () => {
    // Registering a certificate is a REQUIRED capability (§10.1) and
    // hasEntitlement fails CLOSED for unknown keys, so a new key here would
    // silently disable the feature for everyone.
    expect(SRC).not.toContain("hasEntitlement");
  });
});
