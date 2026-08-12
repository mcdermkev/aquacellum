import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Unit tests for relayRegisterTanksBulk ("rack stamping") — the correctness-
 * critical piece of docs/BULK_TANK_CREATE_SPEC.md.
 *
 * Focus is the service invariants (spec §9): unique ids (the Date.now()
 * collision regression), count clamp, row shape, all-or-nothing write, and the
 * initial-log toggle. XP-awarded-once and event-dispatched-once are CALLER
 * responsibilities (the modal), not the service, so they are not asserted here.
 */

// "ethers" is aliased to a window.ethers UMD shim (see vite.config.js). Under
// the node test env there is no window, and relayer.js builds an Interface at
// module load — stub just what it touches.
vi.mock("ethers", () => ({
  ethers: {
    utils: { Interface: class { parseLog() { return null; } } },
  },
}));

// Captured writes so assertions can inspect exactly what hit Dexie.
let tankRows = [];
let actionLogRows = [];
let bulkPutShouldThrow = false;

vi.mock("../db", () => ({
  db: {
    tanks: {
      bulkPut: vi.fn(async (rows) => {
        if (bulkPutShouldThrow) throw new Error("bulkPut boom");
        tankRows.push(...rows);
      }),
    },
    actionLogs: {
      bulkAdd: vi.fn(async (rows) => {
        actionLogRows.push(...rows);
      }),
    },
    specimens: {},
  },
}));

vi.mock("../services/cloudSync", () => ({
  syncTankToCloud: vi.fn(async () => {}),
  syncSpecimenToCloud: vi.fn(async () => {}),
  syncListingToCloud: vi.fn(async () => {}),
  deactivateListingInCloud: vi.fn(async () => {}),
  syncSpawnToCloud: vi.fn(async () => {}),
}));

vi.mock("../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("../services/tankMedia", () => ({
  putSpecimenPhoto: vi.fn(async () => {}),
}));

vi.mock("../services/specimenMetadata", () => ({
  METADATA_STATUS: {},
  normalizeMetadataUri: (x) => x,
  publicMetadataUri: (x) => x,
  publishSpecimenMetadata: vi.fn(async () => ({})),
}));

// buildRegisterTankCall returns null so enqueueOnChain is a no-op (it early-
// returns on falsy calls) — no batch flush, no debounce timers in the test.
// We still spy on the call to prove per-tank on-chain enqueue is attempted.
const buildRegisterTankCall = vi.fn(() => null);
vi.mock("../services/smartAccountClient", () => ({
  submitUserOperation: vi.fn(async () => ({ success: true })),
  buildRegisterTankCall: (...args) => buildRegisterTankCall(...args),
  buildMintSpecimenCall: vi.fn(),
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

import { relayRegisterTanksBulk, buildBulkTankName, MAX_BULK_TANKS } from "../services/relayer";

beforeEach(() => {
  tankRows = [];
  actionLogRows = [];
  bulkPutShouldThrow = false;
  buildRegisterTankCall.mockClear();
});

describe("buildBulkTankName", () => {
  it("appends the sequence to the prefix", () => {
    expect(buildBulkTankName({ prefix: "Grow-out", startNumber: 1, pad: 0 }, 0)).toBe("Grow-out 1");
    expect(buildBulkTankName({ prefix: "Grow-out", startNumber: 1, pad: 0 }, 2)).toBe("Grow-out 3");
  });

  it("respects the start number offset", () => {
    expect(buildBulkTankName({ prefix: "A", startNumber: 5, pad: 0 }, 0)).toBe("A 5");
    expect(buildBulkTankName({ prefix: "A", startNumber: 5, pad: 0 }, 3)).toBe("A 8");
  });

  it("zero-pads when requested", () => {
    expect(buildBulkTankName({ prefix: "A", startNumber: 1, pad: 2 }, 0)).toBe("A 01");
    expect(buildBulkTankName({ prefix: "A", startNumber: 9, pad: 2 }, 1)).toBe("A 10");
    expect(buildBulkTankName({ prefix: "A", startNumber: 1, pad: 3 }, 0)).toBe("A 001");
  });

  it("falls back to 'Unit' for an empty/blank prefix", () => {
    expect(buildBulkTankName({ prefix: "", startNumber: 1 }, 0)).toBe("Unit 1");
    expect(buildBulkTankName({ prefix: "   ", startNumber: 1 }, 0)).toBe("Unit 1");
  });
});

describe("relayRegisterTanksBulk", () => {
  const base = {
    ownerAddress: "0xABCDEF0000000000000000000000000000000001",
    tankType: 1,
    volumeLiters: 38,
    containment: 0,
    facility: "Fish Room",
    room: "Room A",
    rack: "Rack 2",
    namePattern: { prefix: "Grow-out", startNumber: 1, pad: 0 },
  };

  it("creates exactly N rows with DISTINCT ids (Date.now() collision guard)", async () => {
    const res = await relayRegisterTanksBulk({ ...base, count: 50 });
    expect(res.success).toBe(true);
    expect(res.tankIds).toHaveLength(50);
    expect(tankRows).toHaveLength(50);
    const uniqueIds = new Set(tankRows.map((t) => t.id));
    expect(uniqueIds.size).toBe(50);
  });

  it("stamps shared location/type/volume and top-level, active rows", async () => {
    await relayRegisterTanksBulk({ ...base, count: 3 });
    for (const row of tankRows) {
      expect(row.facility).toBe("Fish Room");
      expect(row.room).toBe("Room A");
      expect(row.rack).toBe("Rack 2");
      expect(row.tankType).toBe(1);
      expect(row.volumeLiters).toBe(38);
      expect(row.containment).toBe(0);
      expect(row.parentUnitId).toBe(0);
      expect(row.active).toBe(true);
    }
  });

  it("normalizes the owner address to lowercase", async () => {
    await relayRegisterTanksBulk({ ...base, count: 2 });
    expect(tankRows[0].ownerAddress).toBe(base.ownerAddress.toLowerCase());
  });

  it("names rows from the pattern and returns matching names", async () => {
    const res = await relayRegisterTanksBulk({
      ...base,
      count: 3,
      namePattern: { prefix: "A", startNumber: 1, pad: 2 },
    });
    expect(res.names).toEqual(["A 01", "A 02", "A 03"]);
    expect(tankRows.map((t) => t.name)).toEqual(["A 01", "A 02", "A 03"]);
  });

  it("seeds one initial ParameterLog per tank by default", async () => {
    await relayRegisterTanksBulk({ ...base, count: 4 });
    expect(actionLogRows).toHaveLength(4);
    expect(actionLogRows.every((l) => l.actionType === "ParameterLog")).toBe(true);
    // logs reference the created tank ids
    expect(actionLogRows.map((l) => l.tankId).sort()).toEqual(tankRows.map((t) => t.id).sort());
  });

  it("skips initial logs when seedInitialLog is false", async () => {
    await relayRegisterTanksBulk({ ...base, count: 4, seedInitialLog: false });
    expect(actionLogRows).toHaveLength(0);
  });

  it("attempts a per-tank on-chain enqueue", async () => {
    await relayRegisterTanksBulk({ ...base, count: 5 });
    expect(buildRegisterTankCall).toHaveBeenCalledTimes(5);
  });

  it("rejects a count below 1 and writes nothing", async () => {
    const res = await relayRegisterTanksBulk({ ...base, count: 0 });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/between 1 and/);
    expect(tankRows).toHaveLength(0);
    expect(actionLogRows).toHaveLength(0);
  });

  it("rejects a count above MAX_BULK_TANKS and writes nothing", async () => {
    const res = await relayRegisterTanksBulk({ ...base, count: MAX_BULK_TANKS + 1 });
    expect(res.success).toBe(false);
    expect(tankRows).toHaveLength(0);
  });

  it("accepts exactly MAX_BULK_TANKS", async () => {
    const res = await relayRegisterTanksBulk({ ...base, count: MAX_BULK_TANKS });
    expect(res.success).toBe(true);
    expect(tankRows).toHaveLength(MAX_BULK_TANKS);
  });

  it("is all-or-nothing: a failed bulkPut leaves no tanks and no logs", async () => {
    bulkPutShouldThrow = true;
    const res = await relayRegisterTanksBulk({ ...base, count: 10 });
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
    expect(tankRows).toHaveLength(0);
    expect(actionLogRows).toHaveLength(0);
  });
});
