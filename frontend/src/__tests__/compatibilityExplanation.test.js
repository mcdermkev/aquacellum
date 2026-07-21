/**
 * Unit tests for buildCompatibilityExplanation (Task 8, Tier B).
 *
 * Covers §4.4: blocked/caution/ok each produce the right headline + reasons,
 * no-tank yields the neutral explanation, and the module composes
 * evaluateTankFit rather than re-implementing it (verified by asserting the
 * `score` and `verdict` returned are always exactly what evaluateTankFit
 * itself computes for the same inputs — a fork would drift from this).
 *
 * Run with: npx vitest --run src/__tests__/compatibilityExplanation.test.js
 */

import { describe, it, expect } from "vitest";
import { buildCompatibilityExplanation } from "../services/compatibilityExplanation.js";
import { evaluateTankFit } from "../services/addOnRecommender.js";

const GOOD_FIT_PROFILE = { minVolumeGallons: 10, tempRange: [22, 26], phRange: [6.5, 7.5] };
const GOOD_FIT_TANK = { volume: 40, temp: 24, ph: 7.0 };

const BLOCKED_PROFILE = { minVolumeGallons: 55, tempRange: [24, 28], phRange: [6.0, 7.0] };
const BLOCKED_TANK = { volume: 20, temp: 24, ph: 6.5 }; // < 0.5 * 55

const CAUTION_PROFILE = { minVolumeGallons: 10, tempRange: [22, 26], phRange: [6.5, 7.5] };
const CAUTION_TANK = { volume: 40, temp: 24, ph: 8.2 }; // 0.7 above max, under the 1.0 block threshold

const UNKNOWN_DATA_PROFILE = { tempRange: [22, 26], phRange: [6.5, 7.5] }; // minVolumeGallons unknown

describe("buildCompatibilityExplanation — composes evaluateTankFit (does not re-implement)", () => {
  it("score and verdict exactly match evaluateTankFit's own output for the same inputs (ok)", () => {
    const direct = evaluateTankFit(GOOD_FIT_PROFILE, GOOD_FIT_TANK);
    const explanation = buildCompatibilityExplanation(GOOD_FIT_PROFILE, GOOD_FIT_TANK);
    expect(explanation.score).toBe(direct.score);
    expect(explanation.verdict).toBe(direct.verdict);
  });

  it("score and verdict exactly match evaluateTankFit's own output for the same inputs (blocked)", () => {
    const direct = evaluateTankFit(BLOCKED_PROFILE, BLOCKED_TANK);
    const explanation = buildCompatibilityExplanation(BLOCKED_PROFILE, BLOCKED_TANK);
    expect(explanation.score).toBe(direct.score);
    expect(explanation.verdict).toBe(direct.verdict);
  });

  it("score and verdict exactly match evaluateTankFit's own output for the same inputs (caution)", () => {
    const direct = evaluateTankFit(CAUTION_PROFILE, CAUTION_TANK);
    const explanation = buildCompatibilityExplanation(CAUTION_PROFILE, CAUTION_TANK);
    expect(explanation.score).toBe(direct.score);
    expect(explanation.verdict).toBe(direct.verdict);
  });

  it("changing evaluateTankFit's inputs changes the explanation identically to a direct call (no independent scoring logic)", () => {
    // Sweep several tank volumes and confirm the explanation's score always
    // tracks evaluateTankFit's score exactly — a forked/re-derived scorer
    // would diverge on at least one of these.
    for (const volume of [5, 10, 20, 30, 40, 60, 100]) {
      const tank = { volume, temp: 24, ph: 7.0 };
      const direct = evaluateTankFit(GOOD_FIT_PROFILE, tank);
      const explanation = buildCompatibilityExplanation(GOOD_FIT_PROFILE, tank);
      expect(explanation.score).toBe(direct.score);
      expect(explanation.verdict).toBe(direct.verdict);
    }
  });
});

describe("buildCompatibilityExplanation — verdict-specific headlines and reasons", () => {
  it("ok: positive headline and reasons naming the good matches", () => {
    const result = buildCompatibilityExplanation(GOOD_FIT_PROFILE, GOOD_FIT_TANK);
    expect(result.verdict).toBe("ok");
    expect(result.headline).toBe("Good fit for your tank");
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.some((r) => /meets this species/.test(r))).toBe(true);
    expect(result.reasons.some((r) => /Temperature is a good match/.test(r))).toBe(true);
    expect(result.reasons.some((r) => /pH is a good match/.test(r))).toBe(true);
  });

  it("blocked: warning headline and a humanized volume-mismatch reason", () => {
    const result = buildCompatibilityExplanation(BLOCKED_PROFILE, BLOCKED_TANK);
    expect(result.verdict).toBe("blocked");
    expect(result.headline).toBe("Not a safe fit for your tank");
    expect(result.reasons.some((r) => /well below this species'/.test(r))).toBe(true);
  });

  it("caution: cautionary headline and a borderline-fit reason", () => {
    const result = buildCompatibilityExplanation(CAUTION_PROFILE, CAUTION_TANK);
    expect(result.verdict).toBe("caution");
    expect(result.headline).toBe("Proceed with caution");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("caution (missing data): headline is cautionary and reasons explain the unknown data", () => {
    const result = buildCompatibilityExplanation(UNKNOWN_DATA_PROFILE, GOOD_FIT_TANK);
    expect(result.verdict).toBe("caution");
    expect(result.reasons.some((r) => /don't have a confirmed minimum tank size/.test(r))).toBe(true);
  });

  it("blocked reasons mention temperature when the tank is far outside range", () => {
    const tempBlockedTank = { volume: 40, temp: 35, ph: 7.0 }; // 7C above max (24-28 range)
    const result = buildCompatibilityExplanation(BLOCKED_PROFILE, tempBlockedTank);
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.some((r) => /temperature.*well outside/i.test(r))).toBe(true);
  });

  it("blocked reasons mention pH when the tank is far outside range", () => {
    const phBlockedTank = { volume: 40, temp: 26, ph: 9.0 }; // 2.0 above max (6.0-7.0 range)
    const result = buildCompatibilityExplanation(BLOCKED_PROFILE, phBlockedTank);
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.some((r) => /pH of.*well outside/i.test(r))).toBe(true);
  });
});

describe("buildCompatibilityExplanation — no tank selected", () => {
  it("yields the neutral 'select a tank' explanation for null", () => {
    const result = buildCompatibilityExplanation(GOOD_FIT_PROFILE, null);
    expect(result.verdict).toBe("no_tank");
    expect(result.score).toBe(0);
    expect(result.headline).toBe("Select a tank to check fit");
    expect(result.reasons.length).toBe(1);
    expect(result.reasons[0]).toMatch(/set up your display tank/i);
  });

  it("yields the neutral explanation for undefined", () => {
    const result = buildCompatibilityExplanation(GOOD_FIT_PROFILE, undefined);
    expect(result.verdict).toBe("no_tank");
  });

  it("never calls into a blocked/caution/ok verdict when there's no tank", () => {
    const result = buildCompatibilityExplanation(BLOCKED_PROFILE, null);
    expect(["blocked", "caution", "ok"]).not.toContain(result.verdict);
  });
});
