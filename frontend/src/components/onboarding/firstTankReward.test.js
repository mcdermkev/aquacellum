/**
 * Unit tests for awardFirstTankXp — idempotent first-tank onboarding bonus (task 8.1).
 *
 * Covers the +15 grant (Req 3.4) and its double-count guard: the bonus fires
 * exactly once even when the tour completion is detected twice (event + poll) or
 * the step is re-entered on resume (Property 4 / Property 8). Runs in the
 * project's `node` vitest environment with a stubbed localStorage + mocked xp.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the XP utility so we can assert the grant without touching real storage.
vi.mock("../../utils/xp", () => ({
  addXp: vi.fn(),
  XP_ACTIONS: { REGISTER_TANK: { points: 25, label: "Registered Aquarium Tank" } },
}));

import { addXp } from "../../utils/xp";
import {
  awardFirstTankXp,
  hasAwardedFirstTankXp,
  FIRST_TANK_XP,
  FIRST_TANK_XP_KEY,
} from "./firstTankReward.js";

/** Minimal in-memory localStorage stub for the node test environment. */
function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

describe("awardFirstTankXp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installLocalStorage();
  });

  it("grants +15 XP on the first call", () => {
    expect(hasAwardedFirstTankXp()).toBe(false);

    const result = awardFirstTankXp();

    expect(result).toEqual({ awarded: true, points: FIRST_TANK_XP });
    expect(FIRST_TANK_XP).toBe(15);
    expect(addXp).toHaveBeenCalledTimes(1);
    expect(addXp).toHaveBeenCalledWith(15, expect.any(String));
    expect(hasAwardedFirstTankXp()).toBe(true);
  });

  it("is idempotent: a second call does not re-grant (event + poll race)", () => {
    awardFirstTankXp();
    const second = awardFirstTankXp();

    expect(second).toEqual({ awarded: false, reason: "already-awarded" });
    expect(addXp).toHaveBeenCalledTimes(1);
  });

  it("does not re-grant after a simulated resume (flag already set)", () => {
    localStorage.setItem(FIRST_TANK_XP_KEY, "true");

    const result = awardFirstTankXp();

    expect(result.awarded).toBe(false);
    expect(addXp).not.toHaveBeenCalled();
  });

  it("latches before granting so concurrent calls cannot double-award", () => {
    // Two near-simultaneous detections (event then poll) in the same tick.
    const a = awardFirstTankXp();
    const b = awardFirstTankXp();

    expect([a.awarded, b.awarded].filter(Boolean)).toHaveLength(1);
    expect(addXp).toHaveBeenCalledTimes(1);
  });
});
