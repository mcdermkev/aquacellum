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
/** Existing certificates, used for the local-first species-name fallback. */
let siblingSpecimens = [];
/** Post-mint `specimens.update` calls — life stage and the pedigree chain pointer. */
const specimenPatches = [];
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
    specimens: {
      where: () => ({
        equals: (speciesId) => ({
          first: async () => siblingSpecimens.find((s) => s.speciesId === Number(speciesId)),
        }),
      }),
      update: async (id, patch) => {
        specimenPatches.push({ id: Number(id), patch });
        return 1;
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
  awardXp: (actionKey, opts) => xpCalls.push({ actionKey, ...(opts || {}) }),
  XP_ACTIONS: { MINT_SPECIMEN: { points: 50, label: "Registered Birth Certificate" } },
}));

const {
  promoteCohortToCertificates,
  promotableCount,
  promotionText,
  allPromotionCopy,
  PROMOTE_MAX_PER_ACTION,
  PROMOTED_TYPE,
  PROMOTION_COPY,
  PROMOTION_ERROR,
} = await import("../services/cohortPromotion");
const { summarizeGrowout } = await import("../utils/growoutFunnel");
const { containsProhibitedTerm } = await import("../services/orderCopy");
const { canBeCertificated, promotedLifeStage } = await import("../utils/lifeStage");

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
  siblingSpecimens = [];
  specimenPatches.length = 0;
  mintScript = null;
  nextSerial = 100;
  seedSpawn();
  seedCohort(12);
});

describe("species names resolve local-first, without RPC", () => {
  it("prefers a supplied catalog entry", async () => {
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1, speciesCatalog: CATALOG });
    expect(mintCalls[0].scientificName).toBe("Paracheirodon innesi");
  });

  it("falls back to a sibling certificate of the same species", async () => {
    // Nearly always present for a promotion: the spawn minted offspring when it
    // was recorded, and their names came from the same catalog. This is what
    // keeps the promote path off the RPC enumeration in §9.12.
    siblingSpecimens = [
      { id: 55, speciesId: 42, commonName: "Neon Tetra", scientificName: "Paracheirodon innesi" },
    ];
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1 });
    expect(mintCalls[0].commonName).toBe("Neon Tetra");
    expect(mintCalls[0].scientificName).toBe("Paracheirodon innesi");
  });

  it("leaves the name blank rather than inventing one", async () => {
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1 });
    expect(mintCalls[0].commonName).toBe("Specimen");
    expect(mintCalls[0].scientificName).toBe("Unknown");
  });

  it("ignores a sibling of a different species", async () => {
    siblingSpecimens = [{ id: 9, speciesId: 7, commonName: "Guppy", scientificName: "Poecilia reticulata" }];
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1 });
    expect(mintCalls[0].commonName).toBe("Specimen");
  });
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
    expect(result.errorKey).toBe(PROMOTION_ERROR.NOT_ENOUGH_ALIVE);
    // The count travels as data, not baked into a sentence, so the caller can
    // render it in either mode and the copy invariant stays a plain scan.
    expect(result.available).toBe(4);
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
    // And it names the action rather than passing a prose label the server has to
    // infer from — inference is what silently discarded awards like this one.
    expect(xpCalls[0].actionKey).toBe("MINT_SPECIMEN");
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

// ─── A purchased lot promotes the same way, with two facts different ────────
//
// docs/BREEDER_STATE_MODEL.md §9.25 / §12.4, T3 §2.6. A lot is a cohort that changed
// hands, so everything above applies verbatim. What must NOT be lost is the fact the
// premium rests on: the lineage still traces to the breeder who bred the fish.

describe("promoting out of a purchased lot", () => {
  const MASTER = "0xcccccccccccccccccccccccccccccccccccccccc";
  const LOT_HASH = "d".repeat(64);

  function seedPurchasedLot(overrides = {}) {
    seedSpawn({
      // Intake writes these as 0 — the seller's serials name different fish here.
      sireId: 0,
      damId: 0,
      offspringIds: [],
      offspringCount: 10,
      origin: "purchasedLot",
      lotDocumentHash: LOT_HASH,
      pedigreeDocument: { hash: LOT_HASH, body: { subject: { breeder: MASTER } } },
      ...overrides,
    });
  }

  it("records the BREEDER from the pedigree, not the promoter", async () => {
    // The deciding scenario in §12.3: a master breeder sells premium eggs, the buyer
    // raises them and resells. Naming the buyer as breeder here would erase the one
    // fact that premium rests on, on the first generation, permanently.
    seedPurchasedLot();
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 2 });
    expect(mintCalls).toHaveLength(2);
    for (const call of mintCalls) {
      expect(call.breeder).toBe(MASTER);
      // Owned by the buyer, bred by someone else. Both facts, separately.
      expect(call.ownerAddress).toBe(OWNER);
    }
  });

  it("chains each certificate to the lot document so a resale reaches back", async () => {
    seedPurchasedLot();
    const result = await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 2 });
    expect(result.promoted).toBe(2);
    for (const id of result.specimenIds) {
      const patch = specimenPatches.find((p) => p.id === id)?.patch;
      expect(patch.lotDocumentHash).toBe(LOT_HASH);
      // What `issueTransferDocument` reads when this fish is sold on.
      expect(patch.pedigreeParentDocuments).toEqual({ sire: LOT_HASH, dam: null });
    }
  });

  it("never mints the lot's zeroed parent serials as a pedigree", async () => {
    seedPurchasedLot();
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1 });
    expect(mintCalls[0].sireId).toBe(0);
    expect(mintCalls[0].damId).toBe(0);
    // And it does not print them as if they were a record — see formatCertSerial(0).
    expect(mintCalls[0].metadataDocument.description).toContain(LOT_HASH);
    expect(mintCalls[0].metadataDocument.description).not.toContain("Sire Cert.");
  });

  it("records the promoted stage, so a certificate never sits at a cohort-only one", async () => {
    seedPurchasedLot();
    const result = await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1 });
    const patch = specimenPatches.find((p) => p.id === result.specimenIds[0]).patch;
    expect(patch.lifeStage).toBe(promotedLifeStage());
    expect(canBeCertificated(patch.lifeStage)).toBe(true);
  });

  it("still decrements the cohort — which is what closes §9.26", async () => {
    // A sale never decremented a cohort because a sale produced no cohort. Now it
    // does, and promotion is a departure type, so the count comes down by itself.
    seedPurchasedLot();
    seedCohort(10);
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 4 });
    const checkpoint = growoutRows.find((r) => r.type === PROMOTED_TYPE);
    expect(checkpoint.count).toBe(4);
    expect(summarizeGrowout(checkpointsFor(SPAWN_ID)).alive).toBe(6);
  });

  it("leaves a bred cohort's provenance exactly as it was", async () => {
    // The lot path must be additive. A spawn with no lot document takes the original
    // route, serials and all.
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1 });
    expect(mintCalls[0].breeder).toBe(OWNER);
    expect(mintCalls[0].sireId).toBe(7);
    expect(mintCalls[0].damId).toBe(12);
    expect(mintCalls[0].metadataDocument.description).toContain("Sire Cert.");
    const patch = specimenPatches[0].patch;
    expect(patch.lifeStage).toBe(promotedLifeStage());
    expect(patch.lotDocumentHash).toBeUndefined();
    expect(patch.pedigreeParentDocuments).toBeUndefined();
  });

  it("falls back to the lot owner when the document names no breeder", async () => {
    // An honest fallback, not a guess: the row is still attributed to somebody who
    // demonstrably held the cohort, rather than to nobody.
    seedPurchasedLot({ pedigreeDocument: { hash: LOT_HASH, body: { subject: {} } } });
    await promoteCohortToCertificates({ spawnId: SPAWN_ID, count: 1 });
    expect(mintCalls[0].breeder).toBe(OWNER);
    expect(specimenPatches[0].patch.lotDocumentHash).toBe(LOT_HASH);
  });
});

// ─── Copy ──────────────────────────────────────────────────────────────────

describe("PROMOTION_COPY", () => {
  it("is free of PROHIBITED_TERMS in both modes", () => {
    // `token`, `mint`, and `gas` are prohibited SUBSTRINGS, so "minted" and
    // "tokenised" fail too. The user-facing verbs are register and promote.
    for (const text of allPromotionCopy()) {
      expect(containsProhibitedTerm(text), `string: "${text}"`).toBe(false);
    }
  });

  it("covers every error key the service can return", () => {
    for (const key of Object.values(PROMOTION_ERROR)) {
      expect(PROMOTION_COPY[key], key).toBeTruthy();
      expect(PROMOTION_COPY[key].pro, key).toBeTruthy();
      expect(PROMOTION_COPY[key].casual, key).toBeTruthy();
    }
    // Partial success is not in PROMOTION_ERROR but is a returned key.
    expect(PROMOTION_COPY.partial).toBeTruthy();
  });

  it("resolves by mode and falls back rather than rendering a blank", () => {
    expect(promotionText("cohortEmpty")).toBe(PROMOTION_COPY.cohortEmpty.pro);
    expect(promotionText("cohortEmpty", { casual: true })).toBe(PROMOTION_COPY.cohortEmpty.casual);
    expect(promotionText("no-such-key")).toBe(PROMOTION_COPY.unexpected.pro);
  });

  it("interpolates no counts, so the invariant scan stays exhaustive", () => {
    // Numbers travel on the result object (`available`, `promoted`, `requested`).
    // A template string here would be a string the scan above can never see.
    for (const text of allPromotionCopy()) {
      expect(text, text).not.toMatch(/\$\{|\bundefined\b|\bNaN\b/);
    }
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

describe("the tracker panel wires to the service rather than reimplementing it", () => {
  function code(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  const TRACKER = code("../components/SpawnGrowoutTracker.jsx");

  it("keeps 'promoted' out of the manual type picker", () => {
    // Present in GROWOUT_TYPES so history rows get a label, but a hand-typed
    // promotion would decrement the cohort with no certificates behind it.
    expect(TRACKER).toMatch(/PROGRAMMATIC_TYPES\s*=\s*Object\.freeze\(\["promoted"\]\)/);
    expect(TRACKER).toContain("MANUAL_GROWOUT_TYPES.map");
    expect(TRACKER).not.toContain("Object.entries(GROWOUT_TYPES).map");
  });

  it("never writes a promoted checkpoint itself", () => {
    // The only writer is the service, which counts certificates first.
    expect(TRACKER).toContain("promoteCohortToCertificates");
    expect(TRACKER).not.toMatch(/type:\s*["']promoted["']/);
  });

  it("caps the count input with promotableCount, not a literal", () => {
    expect(TRACKER).toContain("promotableCount(funnel)");
    expect(TRACKER).toContain("max={promotable}");
    expect(TRACKER).not.toMatch(/max=\{?10\}?/);
  });

  it("resolves the spawn from Dexie instead of taking new props", () => {
    expect(TRACKER).toContain("db.spawns.get(Number(spawnId))");
    // The prop list is unchanged, so both mount sites keep working — HatcheryLogs
    // passes only spawnId and eggCount.
    expect(TRACKER).toMatch(
      /function SpawnGrowoutTracker\(\{ spawnId, eggCount, speciesName, mode \}\)/
    );
  });

  it("does not fold promoted fry into the loss figure", () => {
    // A promoted fry is a departure but it is the SUCCESS case. It gets its own
    // line; the funnel's `lost` prop stays culls + natural losses.
    expect(TRACKER).toContain("lost={totalCulled + totalLoss}");
    expect(TRACKER).not.toMatch(/lost=\{[^}]*totalPromoted/);
  });

  it("re-derives the funnel from the stored checkpoints after a promotion", () => {
    // Rather than adjusting a local number, which is how a displayed count drifts
    // away from what was actually written.
    expect(TRACKER).toMatch(/if \(result\.success\) \{[\s\S]{0,400}loadCheckpoints\(\)/);
  });

  it("draws every user-facing string from PROMOTION_COPY", () => {
    expect(TRACKER).toContain("promotionText");
    // No inlined sentences in the panel — the copy invariant has to be able to
    // see them.
    expect(TRACKER).not.toContain("Promote keepers\"");
  });

  it("is still free of entitlement gating", () => {
    expect(TRACKER).not.toContain("hasEntitlement");
  });
});
