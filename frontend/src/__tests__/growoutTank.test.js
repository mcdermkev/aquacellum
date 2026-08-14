import { describe, it, expect, beforeEach, vi } from "vitest";
import { summarizeGrowout } from "../utils/growoutFunnel";

/**
 * Unit tests for setUpGrowoutTank — see docs/GROWOUT_TANK_SPEC.md §5.
 *
 * The invariants that matter: it mints nothing, the `moved` checkpoint does not
 * reduce the cohort, nothing is written when provenance or input is bad, and
 * checkpoint timestamps dodge the cloud mirror's upsert key.
 */

let spawnRows = new Map();
let growoutRows = [];
let tankCalls = [];
let cloudCalls = [];
let xpCalls = [];
let tankShouldFail = false;

vi.mock("../db", () => ({
  db: {
    spawns: {
      get: vi.fn(async (id) => spawnRows.get(Number(id))),
      update: vi.fn(async (id, patch) => {
        const s = spawnRows.get(Number(id));
        if (s) spawnRows.set(Number(id), { ...s, ...patch });
      }),
    },
    spawnGrowout: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({ toArray: async () => growoutRows.filter(() => true) })),
      })),
      add: vi.fn(async (row) => {
        growoutRows.push(row);
        return growoutRows.length;
      }),
    },
  },
}));

vi.mock("../services/relayer", () => ({
  relayImportTanks: vi.fn(async ({ ownerAddress, tanks }) => {
    tankCalls.push({ ownerAddress, tanks });
    if (tankShouldFail) return { success: false, tankIds: [], names: [], error: "boom" };
    return { success: true, tankIds: [909], names: [tanks[0].name] };
  }),
}));

vi.mock("../services/cloudSync", () => ({
  syncGrowoutCheckpointToCloud: vi.fn(async (cp, owner) => {
    cloudCalls.push({ cp, owner });
  }),
}));

vi.mock("../utils/xp", () => ({
  awardXp: vi.fn((key) => xpCalls.push(key)),
}));

import { setUpGrowoutTank, GROWOUT_TANK_ERROR, allGrowoutTankCopy } from "../services/growoutTank";

const OWNER = "0xabcdef0000000000000000000000000000000001";
const SPAWN_ID = 1700000000000;

beforeEach(() => {
  spawnRows = new Map([[SPAWN_ID, { spawnId: SPAWN_ID, ownerAddress: OWNER, tankId: 42, speciesId: 1 }]]);
  growoutRows = [];
  tankCalls = [];
  cloudCalls = [];
  xpCalls = [];
  tankShouldFail = false;
});

describe("setUpGrowoutTank — provenance guards", () => {
  it("fails loudly for a missing spawn and writes nothing", async () => {
    const res = await setUpGrowoutTank({ spawnId: 999 });
    expect(res.success).toBe(false);
    expect(res.errorKey).toBe(GROWOUT_TANK_ERROR.SPAWN_MISSING);
    expect(tankCalls).toHaveLength(0);
    expect(growoutRows).toHaveLength(0);
  });

  it("fails for an unattributed spawn rather than guessing the owner", async () => {
    spawnRows.set(SPAWN_ID, { spawnId: SPAWN_ID, ownerAddress: "", tankId: 42 });
    const res = await setUpGrowoutTank({ spawnId: SPAWN_ID });
    expect(res.errorKey).toBe(GROWOUT_TANK_ERROR.SPAWN_UNATTRIBUTED);
    expect(tankCalls).toHaveLength(0);
    expect(growoutRows).toHaveLength(0);
  });

  it("rejects a non-integer or non-positive headcount before writing anything", async () => {
    for (const bad of [0, -5, 2.5]) {
      const res = await setUpGrowoutTank({ spawnId: SPAWN_ID, fryCount: bad });
      expect(res.errorKey).toBe(GROWOUT_TANK_ERROR.COUNT_INVALID);
    }
    expect(tankCalls).toHaveLength(0);
    expect(growoutRows).toHaveLength(0);
  });

  it("writes no checkpoints and leaves the spawn's tank alone when the tank fails", async () => {
    tankShouldFail = true;
    const res = await setUpGrowoutTank({ spawnId: SPAWN_ID, fryCount: 50 });
    expect(res.errorKey).toBe(GROWOUT_TANK_ERROR.TANK_FAILED);
    expect(growoutRows).toHaveLength(0);
    expect(spawnRows.get(SPAWN_ID).tankId).toBe(42);
    expect(xpCalls).toHaveLength(0);
  });
});

describe("setUpGrowoutTank — success path", () => {
  it("creates exactly one tank, attributed to the SPAWN's owner", async () => {
    const res = await setUpGrowoutTank({ spawnId: SPAWN_ID, tankName: "Fry Rack 1", volumeGal: 20 });
    expect(res.success).toBe(true);
    expect(tankCalls).toHaveLength(1);
    expect(tankCalls[0].tanks).toHaveLength(1);
    expect(tankCalls[0].ownerAddress).toBe(OWNER);
    expect(tankCalls[0].tanks[0].name).toBe("Fry Rack 1");
    expect(tankCalls[0].tanks[0].volumeLiters).toBe(Math.round(20 * 3.78541));
  });

  it("defaults the tank name from the spawn id when none is given", async () => {
    const res = await setUpGrowoutTank({ spawnId: SPAWN_ID });
    expect(res.tankName).toBe(`Grow-out ${String(SPAWN_ID).slice(-3)}`);
  });

  it("always writes a `moved` checkpoint with count 0 and the origin in the note", async () => {
    await setUpGrowoutTank({ spawnId: SPAWN_ID, tankName: "Fry Rack 1" });
    const moved = growoutRows.filter((r) => r.type === "moved");
    expect(moved).toHaveLength(1);
    expect(moved[0].count).toBe(0);
    expect(moved[0].note).toMatch(/from tank 42/);
    expect(moved[0].spawnId).toBe(SPAWN_ID);
  });

  it("the move does NOT reduce the cohort (moved is not a departure)", async () => {
    growoutRows.push({ spawnId: SPAWN_ID, type: "fry_count", count: 100, timestamp: 1 });
    const before = summarizeGrowout(growoutRows).alive;
    await setUpGrowoutTank({ spawnId: SPAWN_ID });
    const after = summarizeGrowout(growoutRows).alive;
    expect(before).toBe(100);
    expect(after).toBe(100);
  });

  it("records a fry_count checkpoint only when a headcount is supplied", async () => {
    await setUpGrowoutTank({ spawnId: SPAWN_ID, fryCount: 80 });
    const fry = growoutRows.filter((r) => r.type === "fry_count");
    expect(fry).toHaveLength(1);
    expect(fry[0].count).toBe(80);
    expect(summarizeGrowout(growoutRows).fry).toBe(80);

    growoutRows = [];
    await setUpGrowoutTank({ spawnId: SPAWN_ID });
    expect(growoutRows.filter((r) => r.type === "fry_count")).toHaveLength(0);
  });

  it("points the spawn at the new grow-out tank", async () => {
    const res = await setUpGrowoutTank({ spawnId: SPAWN_ID });
    expect(res.tankId).toBe(909);
    expect(spawnRows.get(SPAWN_ID).tankId).toBe(909);
    expect(res.movedFrom).toBe(42);
  });

  it("mints nothing — no specimen is created by this path", async () => {
    await setUpGrowoutTank({ spawnId: SPAWN_ID, fryCount: 200 });
    // A cohort is counts, never certificates (§4.2). The only writes are the tank
    // and the checkpoints.
    expect(growoutRows.every((r) => r.type === "fry_count" || r.type === "moved")).toBe(true);
  });

  it("avoids an existing same-type checkpoint in the same second (cloud upsert guard)", async () => {
    const now = Math.round(Date.now() / 1000);
    growoutRows.push({ spawnId: SPAWN_ID, type: "moved", count: 0, timestamp: now });
    await setUpGrowoutTank({ spawnId: SPAWN_ID });
    const moved = growoutRows.filter((r) => r.type === "moved");
    expect(moved).toHaveLength(2);
    expect(moved[0].timestamp).not.toBe(moved[1].timestamp);
  });

  it("mirrors every checkpoint with the spawn's owner", async () => {
    await setUpGrowoutTank({ spawnId: SPAWN_ID, fryCount: 30 });
    expect(cloudCalls).toHaveLength(2);
    expect(cloudCalls.every((c) => c.owner === OWNER)).toBe(true);
  });

  it("awards XP exactly once per successful call", async () => {
    await setUpGrowoutTank({ spawnId: SPAWN_ID, fryCount: 30 });
    expect(xpCalls).toEqual(["GROWOUT_CHECKPOINT"]);
  });

  it("uses a supplied note verbatim", async () => {
    await setUpGrowoutTank({ spawnId: SPAWN_ID, note: "Split off the strongest fry" });
    const moved = growoutRows.find((r) => r.type === "moved");
    expect(moved.note).toBe("Split off the strongest fry");
  });
});

describe("copy", () => {
  it("provides a pro and casual variant for every key", () => {
    const all = allGrowoutTankCopy();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
  });

  it("avoids the prohibited web3 vocabulary", () => {
    for (const line of allGrowoutTankCopy()) {
      expect(line.toLowerCase()).not.toContain("token");
      expect(line.toLowerCase()).not.toContain("mint");
      expect(line.toLowerCase()).not.toContain("gas");
    }
  });
});
