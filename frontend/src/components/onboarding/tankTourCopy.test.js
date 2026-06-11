/**
 * Unit tests for the tank-tour persona-aware copy surface (task 8.1).
 *
 * Verifies the casual/pro tone split (Req 3.2, 8.2) and that `resolveTankCopy`
 * selects sensibly for every persona representation. Runs in the project's
 * `node` vitest environment (pure module, no React/window).
 */

import { describe, it, expect } from "vitest";

import {
  TANK_TOUR_COPY,
  DEFAULT_TANK_NAME,
  resolveTankCopy,
} from "./tankTourCopy.js";

describe("resolveTankCopy", () => {
  it("returns plain strings unchanged", () => {
    expect(resolveTankCopy("hello", true)).toBe("hello");
    expect(resolveTankCopy("hello", false)).toBe("hello");
  });

  it("returns empty string for null/undefined copy", () => {
    expect(resolveTankCopy(null, true)).toBe("");
    expect(resolveTankCopy(undefined, false)).toBe("");
  });

  it("selects casual for true / 'casual'", () => {
    const entry = { casual: "C", pro: "P" };
    expect(resolveTankCopy(entry, true)).toBe("C");
    expect(resolveTankCopy(entry, "casual")).toBe("C");
  });

  it("selects pro for false / 'pro'", () => {
    const entry = { casual: "C", pro: "P" };
    expect(resolveTankCopy(entry, false)).toBe("P");
    expect(resolveTankCopy(entry, "pro")).toBe("P");
  });

  it("defaults to casual when persona is unknown/null", () => {
    const entry = { casual: "C", pro: "P" };
    expect(resolveTankCopy(entry, null)).toBe("C");
    expect(resolveTankCopy(entry, undefined)).toBe("C");
  });

  it("falls back across variants when one tone is missing", () => {
    expect(resolveTankCopy({ casual: "only-casual" }, false)).toBe("only-casual");
    expect(resolveTankCopy({ pro: "only-pro" }, true)).toBe("only-pro");
  });
});

describe("TANK_TOUR_COPY", () => {
  it("provides distinct casual vs pro wording for every entry", () => {
    for (const [key, entry] of Object.entries(TANK_TOUR_COPY)) {
      expect(entry, `${key} should have casual copy`).toHaveProperty("casual");
      expect(entry, `${key} should have pro copy`).toHaveProperty("pro");
      expect(typeof entry.casual).toBe("string");
      expect(typeof entry.pro).toBe("string");
      expect(entry.casual.length).toBeGreaterThan(0);
      expect(entry.pro.length).toBeGreaterThan(0);
    }
  });

  it("keeps casual tank wording jargon-free (no 'containment unit')", () => {
    expect(TANK_TOUR_COPY.title.casual.toLowerCase()).not.toContain("containment");
    expect(TANK_TOUR_COPY.fallbackTitle.casual.toLowerCase()).not.toContain("containment");
  });

  it("uses operational language in pro mode", () => {
    expect(TANK_TOUR_COPY.fallbackTitle.pro.toLowerCase()).toContain("unit");
  });

  it("offers a continue affordance so failures never block onboarding (Req 3.6)", () => {
    expect(resolveTankCopy(TANK_TOUR_COPY.continueAnyway, true)).toBeTruthy();
    expect(resolveTankCopy(TANK_TOUR_COPY.continueAnyway, false)).toBeTruthy();
  });
});

describe("DEFAULT_TANK_NAME", () => {
  it("pre-fills a friendly casual name and an operational pro name", () => {
    expect(resolveTankCopy(DEFAULT_TANK_NAME, true)).toBe("My First Tank");
    expect(resolveTankCopy(DEFAULT_TANK_NAME, false)).toBe("Primary Unit");
  });
});
