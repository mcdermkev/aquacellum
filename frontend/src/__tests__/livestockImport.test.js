import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Unit tests for relayImportSpecimens (livestock importer) — the identity-
 * critical service. Focus: sequential serials continuing from the existing max
 * (collision guard), correct specimen shape (status/gender/lineage), tank
 * embedding, caps, and transactional all-or-nothing.
 *
 * XP-once / event-once are the modal's job, not the service, so not asserted.
 */

// "ethers" alias shim needs a stub under the node env (see bulkTankCreate.test).
vi.mock("ethers", () => ({
  ethers: { utils: { Interface: class { parseLog() { return null; } } } },
}));

// In-memory Dexie stand-ins.
let specimenRows = [];
let existingSpecimens = [];
let tanksMap = new Map();
let bulkPutShouldThrow = false;

vi.mock("../db", () => ({
  db: {
    specimens: {
      toArray: vi.fn(async () => existingSpecimens),
      bulkPut: vi.fn(async (rows) => {
        if (bulkPutShouldThrow) throw new Error("bulkPut boom");
        specimenRows.push(...rows);
      }),
    },
    tanks: {
      get: vi.fn(async (id) => tanksMap.get(Number(id))),
      update: vi.fn(async (id, patch) => {
        const t = tanksMap.get(Number(id));
        if (t) tanksMap.set(Number(id), { ...t, ...patch });
      }),
    },
    // Run the transaction body immediately; the last arg is the callback.
    transaction: vi.fn(async (_mode, ...rest) => {
      const fn = rest[rest.length - 1];
      return fn();
    }),
  },
}));

vi.mock("../services/cloudSync", () => ({
  syncTankToCloud: vi.fn(async () => {}),
  syncSpecimenToCloud: vi.fn(async () => {}),
  syncListingToCloud: vi.fn(async () => {}),
  deactivateListingInCloud: vi.fn(async () => {}),
  syncSpawnToCloud: vi.fn(async () => {}),
}));
vi.mock("../services/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../services/tankMedia", () => ({ putSpecimenPhoto: vi.fn(async () => {}) }));
vi.mock("../services/specimenMetadata", () => ({
  METADATA_STATUS: { NONE: "none" },
  normalizeMetadataUri: (x) => x,
  publicMetadataUri: (x) => x,
  publishSpecimenMetadata: vi.fn(async () => ({})),
}));
vi.mock("../services/smartAccountClient", () => ({
  submitUserOperation: vi.fn(async () => ({ success: true })),
  buildMintSpecimenCall: vi.fn(() => null), // null → enqueueOnChain no-ops (no timers)
  buildRegisterTankCall: vi.fn(() => null),
  buildLogWaterParametersCall: vi.fn(),
  buildMoveSpecimenCall: vi.fn(),
  buildInitiateSpawnCall: vi.fn(),
  buildListSpecimenCall: vi.fn(),
  buildCancelListingCall: vi.fn(),
  buildApproveCall: vi.fn(),
  buildCreateShippingListingCall: vi.fn(),
  buildDispatchShippingCall: vi.fn(),
  buildReleaseFiatShippingEscrowCall: vi.fn(),
  buildDisputeShippingCall: vi.fn(),
  buildResolveShippingDisputeCall: vi.fn(),
}));

import { relayImportSpecimens, MAX_IMPORT_SPECIMENS } from "../services/relayer";

const owner = "0xABCDEF0000000000000000000000000000000001";

beforeEach(() => {
  specimenRows = [];
  existingSpecimens = [];
  tanksMap = new Map();
  bulkPutShouldThrow = false;
});

describe("relayImportSpecimens", () => {
  const spec = (over = {}) => ({
    speciesId: 1,
    commonName: "Guppy",
    scientificName: "Poecilia reticulata",
    gender: "Unsexed",
    currentTankId: 0,
    ...over,
  });

  it("creates one row per spec with distinct sequential serials from 1", async () => {
    const res = await relayImportSpecimens({ ownerAddress: owner, specimens: [spec(), spec(), spec()] });
    expect(res.success).toBe(true);
    expect(res.specimenIds).toEqual([1, 2, 3]);
    expect(new Set(specimenRows.map((r) => r.id)).size).toBe(3);
  });

  it("continues serials from the existing max (ignoring legacy huge ids)", async () => {
    existingSpecimens = [{ id: 7 }, { id: 1699999999999 /* legacy Date.now() */ }];
    const res = await relayImportSpecimens({ ownerAddress: owner, specimens: [spec(), spec()] });
    expect(res.specimenIds).toEqual([8, 9]);
  });

  it("writes safe identity fields: status 0, normalized gender, sire/dam 0", async () => {
    await relayImportSpecimens({
      ownerAddress: owner,
      specimens: [spec({ gender: "f" }), spec({ gender: "mixed" })],
    });
    expect(specimenRows[0].status).toBe(0);
    expect(specimenRows[0].gender).toBe("Female");
    expect(specimenRows[1].gender).toBe("Unsexed");
    for (const r of specimenRows) {
      expect(r.sireId).toBe(0);
      expect(r.damId).toBe(0);
      expect(r.ownerAddress).toBe(owner.toLowerCase());
      expect(r.speciesId).toBe(1);
      expect(r.commonName).toBe("Guppy");
    }
  });

  it("appends tank-assigned fish to that tank's specimens[]; leaves unassigned out", async () => {
    tanksMap.set(100, { id: 100, specimens: [] });
    await relayImportSpecimens({
      ownerAddress: owner,
      specimens: [spec({ currentTankId: 100 }), spec({ currentTankId: 100 }), spec({ currentTankId: 0 })],
    });
    expect(tanksMap.get(100).specimens).toHaveLength(2);
    expect(tanksMap.get(100).specimens[0]).toMatchObject({ speciesId: 1, status: 0 });
  });

  it("persists a supplied breederStockTag and defaults it to empty", async () => {
    await relayImportSpecimens({
      ownerAddress: owner,
      specimens: [spec({ breederStockTag: "  Blue Grass A1  " }), spec()],
    });
    // Trimmed, so a line label round-trips as the breeder typed it.
    expect(specimenRows[0].breederStockTag).toBe("Blue Grass A1");
    expect(specimenRows[1].breederStockTag).toBe("");
  });

  it("rejects an empty list and writes nothing", async () => {
    const res = await relayImportSpecimens({ ownerAddress: owner, specimens: [] });
    expect(res.success).toBe(false);
    expect(specimenRows).toHaveLength(0);
  });

  it("rejects more than MAX_IMPORT_SPECIMENS", async () => {
    const many = Array.from({ length: MAX_IMPORT_SPECIMENS + 1 }, () => spec());
    const res = await relayImportSpecimens({ ownerAddress: owner, specimens: many });
    expect(res.success).toBe(false);
    expect(specimenRows).toHaveLength(0);
  });

  it("is all-or-nothing: a failed bulkPut leaves no specimens and no tank mutations", async () => {
    tanksMap.set(100, { id: 100, specimens: [] });
    bulkPutShouldThrow = true;
    const res = await relayImportSpecimens({ ownerAddress: owner, specimens: [spec({ currentTankId: 100 })] });
    expect(res.success).toBe(false);
    expect(specimenRows).toHaveLength(0);
    expect(tanksMap.get(100).specimens).toHaveLength(0);
  });
});
