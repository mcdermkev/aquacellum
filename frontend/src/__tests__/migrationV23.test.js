/**
 * Integration test for the v23 logbook-spine migration (Logbook Rework Task 1/11).
 *
 * Runs the REAL `upgradeV23` transformation against a controlled Dexie backed by
 * fake-indexeddb: seed v22-era `tanks` + `actionLogs`, trigger the upgrade, and
 * assert the saltwater remap, typed-payload backfill, and paramReadings seed.
 */
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, it, expect, afterEach } from "vitest";
import { upgradeV23 } from "../db";

const V1_STORES = {
  tanks: "id, ownerAddress, name, active",
  actionLogs: "++id, tankId, actionType, timestamp, details",
};

const V2_STORES = {
  ...V1_STORES,
  paramReadings: "++id, tankId, timestamp, source, [tankId+timestamp]",
  tankSchedules: "++id, tankId, kind, nextDueAt, enabled, [tankId+kind]",
  tankMedia: "++id, refType, refId, createdAt, [refType+refId]",
};

let dbName;

afterEach(async () => {
  if (dbName) {
    await Dexie.delete(dbName);
    dbName = null;
  }
});

async function seedThenUpgrade(seed) {
  dbName = `MigTest_${Math.random().toString(36).slice(2)}`;

  // 1. Create the pre-migration DB (v1) and seed v22-era data.
  const before = new Dexie(dbName);
  before.version(1).stores(V1_STORES);
  await before.open();
  if (seed.tanks) await before.tanks.bulkAdd(seed.tanks);
  if (seed.actionLogs) await before.actionLogs.bulkAdd(seed.actionLogs);
  before.close();

  // 2. Reopen with the v2 schema + the REAL upgrade → triggers upgradeV23.
  const after = new Dexie(dbName);
  after.version(1).stores(V1_STORES);
  after.version(2).stores(V2_STORES).upgrade(upgradeV23);
  await after.open();

  const result = {
    tanks: await after.tanks.toArray(),
    actionLogs: await after.actionLogs.toArray(),
    paramReadings: await after.paramReadings.toArray(),
  };
  after.close();
  return result;
}

describe("v23 migration — upgradeV23", () => {
  it("converts legacy saltwater tanks (tankType 1) to freshwater (0)", async () => {
    const { tanks } = await seedThenUpgrade({
      tanks: [
        { id: 1, tankType: 1, name: "Reef", active: true, ownerAddress: "0xabc" },
        { id: 2, tankType: 0, name: "Community", active: true, ownerAddress: "0xabc" },
        { id: 3, tankType: 2, name: "Brackish", active: true, ownerAddress: "0xabc" },
      ],
    });
    expect(tanks.find((t) => t.id === 1).tankType).toBe(0); // saltwater → freshwater
    expect(tanks.find((t) => t.id === 2).tankType).toBe(0); // unchanged
    expect(tanks.find((t) => t.id === 3).tankType).toBe(2); // brackish unchanged
  });

  it("backfills typed payloads on existing action logs", async () => {
    const { actionLogs } = await seedThenUpgrade({
      actionLogs: [
        { tankId: 1, actionType: "Water Change", timestamp: 100, details: "40% water change performed" },
        { tankId: 1, actionType: "Feed", timestamp: 200, details: "flake food" },
        { tankId: 1, actionType: "Quick Water Test", timestamp: 300, details: "Baseline Water Test (Temp: 24.5°C, pH: 7.2)" },
      ],
    });
    const byType = Object.fromEntries(actionLogs.map((l) => [l.actionType, l.payload]));
    expect(byType["Water Change"]).toMatchObject({ kind: "waterChange", percent: 40, _backfilled: true });
    expect(byType["Feed"]).toMatchObject({ kind: "feed" });
    expect(byType["Quick Water Test"]).toMatchObject({ kind: "test", temp: 24.5, ph: 7.2 });
  });

  it("seeds paramReadings from parseable water-test logs only", async () => {
    const { paramReadings } = await seedThenUpgrade({
      actionLogs: [
        { tankId: 7, actionType: "Quick Water Test", timestamp: 300, details: "Baseline Water Test (Temp: 24.5°C, pH: 7.2)" },
        { tankId: 7, actionType: "Feed", timestamp: 400, details: "no params here" },
        { tankId: 7, actionType: "Detailed Test", timestamp: 500, details: "nothing parseable" },
      ],
    });
    // Only the first test log has parseable temp/pH → exactly one seeded reading.
    expect(paramReadings).toHaveLength(1);
    expect(paramReadings[0]).toMatchObject({ tankId: 7, timestamp: 300, temp: 24.5, ph: 7.2, source: "backfill" });
  });

  it("does not double-write payloads if a log already has one", async () => {
    const { actionLogs } = await seedThenUpgrade({
      actionLogs: [
        { tankId: 1, actionType: "Feed", timestamp: 100, details: "x", payload: { kind: "feed", custom: true } },
      ],
    });
    expect(actionLogs[0].payload).toEqual({ kind: "feed", custom: true }); // untouched
  });
});
