/**
 * Unit tests for persistCompanionOnHatch — idempotent Echo companion persist.
 *
 * Covers the hatch write (Requirement 2.4) and its idempotency guard
 * (Property 8 — resumability via existence checks): a new row is written once,
 * an existing row is never overwritten/duplicated, and missing-account / error
 * paths are handled gracefully.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Dexie layer so the helper can be tested without IndexedDB.
vi.mock("../../db.js", () => ({
  db: { breederCompanion: { get: vi.fn(), add: vi.fn() } },
}));

import {
  persistCompanionOnHatch,
  buildInitialCompanion,
  ECHO_EGG_STATE_HATCHED,
  ECHO_INITIAL_XP,
  ECHO_INITIAL_TIER,
} from "./persistCompanion.js";
import { db } from "../../db.js";

const ACCOUNT = "0xabc123";

describe("buildInitialCompanion", () => {
  it("produces the design-specified hatched companion shape", () => {
    expect(buildInitialCompanion(ACCOUNT)).toEqual({
      walletAddress: ACCOUNT,
      eggState: ECHO_EGG_STATE_HATCHED,
      companionXp: ECHO_INITIAL_XP,
      currentTier: ECHO_INITIAL_TIER,
      selectedStats: {},
      zoneHash: null,
    });
  });

  it("uses Bronze tier and a hatched egg state by default", () => {
    const row = buildInitialCompanion(ACCOUNT);
    expect(row.currentTier).toBe("Bronze");
    expect(row.eggState).toBe(1);
    expect(row.companionXp).toBe(15);
  });
});

describe("persistCompanionOnHatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a new companion row when none exists", async () => {
    db.breederCompanion.get.mockResolvedValue(undefined);
    db.breederCompanion.add.mockResolvedValue(ACCOUNT);

    await expect(persistCompanionOnHatch(ACCOUNT)).resolves.toEqual({ created: true });

    expect(db.breederCompanion.get).toHaveBeenCalledWith(ACCOUNT);
    expect(db.breederCompanion.add).toHaveBeenCalledWith(buildInitialCompanion(ACCOUNT));
  });

  it("is idempotent: does not overwrite or duplicate an existing row", async () => {
    const existing = {
      walletAddress: ACCOUNT,
      eggState: 1,
      companionXp: 9999,
      currentTier: "Gold",
      selectedStats: {},
      zoneHash: null,
    };
    db.breederCompanion.get.mockResolvedValue(existing);

    await expect(persistCompanionOnHatch(ACCOUNT)).resolves.toEqual({
      created: false,
      reason: "exists",
    });

    expect(db.breederCompanion.add).not.toHaveBeenCalled();
  });

  it("no-ops when no account is connected (no pre-account writes)", async () => {
    await expect(persistCompanionOnHatch(null)).resolves.toEqual({
      created: false,
      reason: "no-account",
    });

    expect(db.breederCompanion.get).not.toHaveBeenCalled();
    expect(db.breederCompanion.add).not.toHaveBeenCalled();
  });

  it("swallows Dexie errors and reports skipped so onboarding can proceed", async () => {
    db.breederCompanion.get.mockRejectedValue(new Error("dexie down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(persistCompanionOnHatch(ACCOUNT)).resolves.toEqual({
      created: false,
      reason: "error",
    });

    expect(db.breederCompanion.add).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
