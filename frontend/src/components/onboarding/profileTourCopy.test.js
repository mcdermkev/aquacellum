/**
 * Unit tests for the profile-picture-nudge persona-aware copy surface (task 8.3).
 *
 * Verifies the casual/pro tone split and that `resolveProfileCopy` selects
 * sensibly for every persona representation. Runs in the project's `node` vitest
 * environment (pure module, no React/window).
 *
 * Validates: Requirements 7.3, 7.4, 7.5
 */

import { describe, it, expect } from "vitest";

import { PROFILE_TOUR_COPY, resolveProfileCopy } from "./profileTourCopy.js";

describe("resolveProfileCopy", () => {
  it("returns plain strings unchanged", () => {
    expect(resolveProfileCopy("hello", true)).toBe("hello");
    expect(resolveProfileCopy("hello", false)).toBe("hello");
  });

  it("returns empty string for null/undefined copy", () => {
    expect(resolveProfileCopy(null, true)).toBe("");
    expect(resolveProfileCopy(undefined, false)).toBe("");
  });

  it("selects casual for true / 'casual'", () => {
    const entry = { casual: "C", pro: "P" };
    expect(resolveProfileCopy(entry, true)).toBe("C");
    expect(resolveProfileCopy(entry, "casual")).toBe("C");
  });

  it("selects pro for false / 'pro'", () => {
    const entry = { casual: "C", pro: "P" };
    expect(resolveProfileCopy(entry, false)).toBe("P");
    expect(resolveProfileCopy(entry, "pro")).toBe("P");
  });

  it("defaults to casual when persona is unknown/null", () => {
    const entry = { casual: "C", pro: "P" };
    expect(resolveProfileCopy(entry, null)).toBe("C");
    expect(resolveProfileCopy(entry, undefined)).toBe("C");
  });

  it("falls back across variants when one tone is missing", () => {
    expect(resolveProfileCopy({ casual: "only-casual" }, false)).toBe("only-casual");
    expect(resolveProfileCopy({ pro: "only-pro" }, true)).toBe("only-pro");
  });
});

describe("PROFILE_TOUR_COPY", () => {
  it("provides distinct casual vs pro wording for every entry", () => {
    for (const [key, entry] of Object.entries(PROFILE_TOUR_COPY)) {
      expect(entry, `${key} should have casual copy`).toHaveProperty("casual");
      expect(entry, `${key} should have pro copy`).toHaveProperty("pro");
      expect(typeof entry.casual).toBe("string");
      expect(typeof entry.pro).toBe("string");
      expect(entry.casual.length).toBeGreaterThan(0);
      expect(entry.pro.length).toBeGreaterThan(0);
    }
  });

  it("nudges the user toward the profile widget / view-profile flow (Req 7.3, 7.4)", () => {
    expect(PROFILE_TOUR_COPY.instruction.casual.toLowerCase()).toContain("profile");
    expect(PROFILE_TOUR_COPY.instruction.pro.toLowerCase()).toContain("profile");
  });

  it("offers a skip affordance so the picture stays optional (Req 7.5)", () => {
    expect(resolveProfileCopy(PROFILE_TOUR_COPY.skip, true)).toBeTruthy();
    expect(resolveProfileCopy(PROFILE_TOUR_COPY.skip, false)).toBeTruthy();
  });

  it("offers a continue affordance so a missing picture never blocks completion (Req 7.5)", () => {
    expect(resolveProfileCopy(PROFILE_TOUR_COPY.continueAnyway, true)).toBeTruthy();
    expect(resolveProfileCopy(PROFILE_TOUR_COPY.continueAnyway, false)).toBeTruthy();
  });
});
