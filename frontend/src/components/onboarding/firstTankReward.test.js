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
//
// Note this mock already declared REGISTER_TANK as 25 while the module under test
// hardcoded 15 — the divergence was sitting in the fixture the whole time.
vi.mock("../../utils/xp", () => ({
  awardXp: vi.fn(),
  XP_ACTIONS: { REGISTER_TANK: { points: 25, label: "Registered Aquarium Tank" } },
}));

import { awardXp, XP_ACTIONS } from "../../utils/xp";
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

  it("grants the canonical REGISTER_TANK award on the first call", () => {
    expect(hasAwardedFirstTankXp()).toBe(false);

    const result = awardFirstTankXp();

    expect(result).toEqual({ awarded: true, points: FIRST_TANK_XP });
    // Was pinned at 15 while XP_ACTIONS.REGISTER_TANK said 25. Registering your first
    // tank is registering a tank, so the bonus is now derived from that one action —
    // the divergence is what made the server reject and claw back the grant.
    expect(FIRST_TANK_XP).toBe(XP_ACTIONS.REGISTER_TANK.points);
    // Awards must name their action, not a prose label the server has to guess at.
    expect(awardXp).toHaveBeenCalledTimes(1);
    expect(awardXp).toHaveBeenCalledWith("REGISTER_TANK");
    expect(hasAwardedFirstTankXp()).toBe(true);
  });

  it("is idempotent: a second call does not re-grant (event + poll race)", () => {
    awardFirstTankXp();
    const second = awardFirstTankXp();

    expect(second).toEqual({ awarded: false, reason: "already-awarded" });
    expect(awardXp).toHaveBeenCalledTimes(1);
  });

  it("does not re-grant after a simulated resume (flag already set)", () => {
    localStorage.setItem(FIRST_TANK_XP_KEY, "true");

    const result = awardFirstTankXp();

    expect(result.awarded).toBe(false);
    expect(awardXp).not.toHaveBeenCalled();
  });

  it("latches before granting so concurrent calls cannot double-award", () => {
    // Two near-simultaneous detections (event then poll) in the same tick.
    const a = awardFirstTankXp();
    const b = awardFirstTankXp();

    expect([a.awarded, b.awarded].filter(Boolean)).toHaveLength(1);
    expect(awardXp).toHaveBeenCalledTimes(1);
  });
});
