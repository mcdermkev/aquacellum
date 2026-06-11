/**
 * Unit tests for the EchoStage hatch lifecycle.
 *
 * The component itself is DOM/timer driven and this project's vitest runs in a
 * `node` environment (no jsdom), so these tests focus on the pure
 * `nextEchoState` transition helper and the exported constants — the logic that
 * decides how the egg → crack → fry lifecycle advances.
 */
import { describe, it, expect } from "vitest";

import {
  nextEchoState,
  ECHO_STATES,
  DEFAULT_NUDGE_DELAY,
} from "./EchoStage.jsx";

describe("nextEchoState", () => {
  it("advances idle → cracking when motion is allowed", () => {
    expect(nextEchoState("idle", false)).toBe("cracking");
  });

  it("advances idle → hatched directly under reduced motion", () => {
    // Reduced motion cross-fades straight to the same end state (Req 2.3/9.3).
    expect(nextEchoState("idle", true)).toBe("hatched");
  });

  it("advances cracking → hatched regardless of motion preference", () => {
    expect(nextEchoState("cracking", false)).toBe("hatched");
    expect(nextEchoState("cracking", true)).toBe("hatched");
  });

  it("treats hatched as terminal", () => {
    expect(nextEchoState("hatched", false)).toBe("hatched");
    expect(nextEchoState("hatched", true)).toBe("hatched");
  });

  it("defaults reducedMotion to false when omitted", () => {
    expect(nextEchoState("idle")).toBe("cracking");
  });

  it("falls back to hatched for unknown states", () => {
    expect(nextEchoState("unknown")).toBe("hatched");
    expect(nextEchoState(undefined)).toBe("hatched");
  });

  it("every reachable target is a valid declared state", () => {
    for (const from of ["idle", "cracking", "hatched"]) {
      expect(ECHO_STATES).toContain(nextEchoState(from, false));
      expect(ECHO_STATES).toContain(nextEchoState(from, true));
    }
  });

  it("under reduced motion, hatched is reachable from idle in one step (no unreachable step)", () => {
    // Property 7 (reduced-motion safety): the animated path's end state is also
    // reachable without animation.
    expect(nextEchoState("idle", true)).toBe("hatched");
  });
});

describe("EchoStage exported constants", () => {
  it("declares the three lifecycle states in order", () => {
    expect(ECHO_STATES).toEqual(["idle", "cracking", "hatched"]);
  });

  it("uses a ~6s default nudge delay (Req 2.3)", () => {
    expect(DEFAULT_NUDGE_DELAY).toBe(6000);
  });
});
