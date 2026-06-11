/**
 * Unit tests for the Echo companion hatch-persistence helper (task 5.2).
 *
 * Covers:
 *   - buildEchoCompanionRecord() produces the exact design record shape.
 *   - persistEchoCompanion() inserts on first hatch.
 *   - Idempotency: an existing row is never overwritten or duplicated
 *     (Property 8 — resumability guarded by existence checks).
 *   - No-account is a safe no-op (Property 3 — account-gated persistence).
 *   - A concurrent ConstraintError is treated as an idempotent no-op.
 *   - Unexpected errors are swallowed (a hatch never crashes onboarding).
 *
 * The helper accepts an injected `database`, so these tests use a tiny in-memory
 * fake of the Dexie `breederCompanion` table — no IndexedDB required.
 *
 * Validates: Requirements 2.4.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  persistEchoCompanion,
  buildEchoCompanionRecord,
  HATCHED_EGG_STATE,
  INITIAL_COMPANION_XP,
  INITIAL_COMPANION_TIER,
} from "./echoCompanion.js";

const ACCOUNT = "0xabc123";

/** Minimal in-memory stand-in for the Dexie `breederCompanion` table. */
function makeFakeDb() {
  const rows = new Map();
  return {
    rows,
    breederCompanion: {
      get: vi.fn(async (key) => rows.get(key)),
      add: vi.fn(async (record) => {
        if (rows.has(record.walletAddress)) {
          const err = new Error("Key already exists");
          err.name = "ConstraintError";
          throw err;
        }
        rows.set(record.walletAddress, record);
        return record.walletAddress;
      }),
    },
  };
}

describe("buildEchoCompanionRecord", () => {
  it("produces the exact design record shape", () => {
    expect(buildEchoCompanionRecord(ACCOUNT)).toEqual({
      walletAddress: ACCOUNT,
      eggState: HATCHED_EGG_STATE,
      companionXp: INITIAL_COMPANION_XP,
      currentTier: INITIAL_COMPANION_TIER,
      selectedStats: {},
      zoneHash: null,
    });
  });

  it("uses the conventional starting values (hatched egg, Bronze, +15 XP)", () => {
    expect(HATCHED_EGG_STATE).toBe(1);
    expect(INITIAL_COMPANION_XP).toBe(15);
    expect(INITIAL_COMPANION_TIER).toBe("Bronze");
  });
});

describe("persistEchoCompanion", () => {
  let fake;

  beforeEach(() => {
    fake = makeFakeDb();
  });

  it("inserts the initial companion record on first hatch", async () => {
    const result = await persistEchoCompanion(ACCOUNT, { database: fake });

    expect(result).toEqual({ created: true });
    expect(fake.breederCompanion.add).toHaveBeenCalledTimes(1);
    expect(fake.rows.get(ACCOUNT)).toEqual(buildEchoCompanionRecord(ACCOUNT));
  });

  it("is idempotent: does not overwrite or duplicate an existing row", async () => {
    // Seed an existing companion with progressed state.
    const existing = {
      walletAddress: ACCOUNT,
      eggState: 2,
      companionXp: 9000,
      currentTier: "Gold",
      selectedStats: { tankCount: true },
      zoneHash: "zone-1",
    };
    fake.rows.set(ACCOUNT, existing);

    const result = await persistEchoCompanion(ACCOUNT, { database: fake });

    expect(result).toEqual({ created: false, reason: "exists" });
    expect(fake.breederCompanion.add).not.toHaveBeenCalled();
    // Existing progressed state is untouched.
    expect(fake.rows.get(ACCOUNT)).toEqual(existing);
  });

  it("calling twice creates exactly one row (re-entry / double-fire safe)", async () => {
    const first = await persistEchoCompanion(ACCOUNT, { database: fake });
    const second = await persistEchoCompanion(ACCOUNT, { database: fake });

    expect(first).toEqual({ created: true });
    expect(second).toEqual({ created: false, reason: "exists" });
    expect(fake.breederCompanion.add).toHaveBeenCalledTimes(1);
    expect(fake.rows.size).toBe(1);
  });

  it("no-ops when there is no account (account-gated persistence)", async () => {
    const result = await persistEchoCompanion(null, { database: fake });

    expect(result).toEqual({ created: false, reason: "no-account" });
    expect(fake.breederCompanion.get).not.toHaveBeenCalled();
    expect(fake.breederCompanion.add).not.toHaveBeenCalled();
  });

  it("treats a concurrent ConstraintError as an idempotent no-op", async () => {
    // Existence check passes (empty), but add throws as if a row appeared.
    fake.breederCompanion.get.mockResolvedValueOnce(undefined);
    fake.breederCompanion.add.mockImplementationOnce(async () => {
      const err = new Error("Key already exists");
      err.name = "ConstraintError";
      throw err;
    });

    const result = await persistEchoCompanion(ACCOUNT, { database: fake });
    expect(result).toEqual({ created: false, reason: "exists" });
  });

  it("swallows unexpected errors so a hatch never crashes onboarding", async () => {
    fake.breederCompanion.get.mockRejectedValueOnce(new Error("boom"));

    const result = await persistEchoCompanion(ACCOUNT, { database: fake });
    expect(result.created).toBe(false);
    expect(result.reason).toBe("error");
  });
});
