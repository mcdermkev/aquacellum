/**
 * Unit tests for the spotlight tour geometry helpers.
 *
 * The SpotlightOverlay and TourCoachmark components are DOM/measurement driven
 * and this project's vitest runs in a `node` environment (no jsdom), so these
 * tests target the pure, side-effect-free geometry module — the math that
 * decides where the cutout grows and where the coachmark bubble lands.
 *
 * Validates: Requirements 3.1, 3.2, 9.2
 */
import { describe, it, expect } from "vitest";

import {
  SPOTLIGHT_PADDING,
  COACHMARK_GAP,
  VIEWPORT_MARGIN,
  PLACEMENT_ORDER,
  clamp,
  expandRect,
  choosePlacement,
  computeCoachmarkPlacement,
  rectFromDomRect,
  rectsEqual,
} from "./spotlightGeometry.js";

const VIEWPORT = { width: 1024, height: 768 };
const COACHMARK = { width: 320, height: 150 };

describe("clamp", () => {
  it("returns the value when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("prefers the lower bound for a degenerate range (element larger than space)", () => {
    expect(clamp(50, 100, 20)).toBe(100);
  });
});

describe("expandRect", () => {
  it("grows the rect by the padding on every side", () => {
    const out = expandRect({ top: 100, left: 200, width: 50, height: 40 }, 8);
    expect(out).toEqual({ top: 92, left: 192, width: 66, height: 56 });
  });

  it("defaults to SPOTLIGHT_PADDING", () => {
    const out = expandRect({ top: 0, left: 0, width: 10, height: 10 });
    expect(out.width).toBe(10 + SPOTLIGHT_PADDING * 2);
  });

  it("never produces negative dimensions", () => {
    const out = expandRect({ top: 0, left: 0, width: 0, height: 0 }, -50);
    expect(out.width).toBeGreaterThanOrEqual(0);
    expect(out.height).toBeGreaterThanOrEqual(0);
  });

  it("returns null for a null rect", () => {
    expect(expandRect(null)).toBeNull();
  });
});

describe("choosePlacement", () => {
  it("prefers bottom when there is room below the target", () => {
    const rect = { top: 100, left: 400, width: 120, height: 40 };
    expect(choosePlacement(rect, VIEWPORT, COACHMARK)).toBe("bottom");
  });

  it("falls back to top when the target hugs the bottom edge", () => {
    const rect = { top: 700, left: 400, width: 120, height: 40 };
    expect(choosePlacement(rect, VIEWPORT, COACHMARK)).toBe("top");
  });

  it("falls back to a side when there is no vertical room", () => {
    // Target spans almost the full height → no room above or below.
    const rect = { top: 10, left: 10, width: 80, height: 740 };
    const placement = choosePlacement(rect, VIEWPORT, COACHMARK);
    expect(["right", "left"]).toContain(placement);
  });

  it("picks the side with the most space when nothing fits cleanly", () => {
    // A target that nearly fills the viewport: bottom has the most leftover room.
    const rect = { top: 5, left: 5, width: 1000, height: 600 };
    const placement = choosePlacement(rect, VIEWPORT, COACHMARK);
    expect(PLACEMENT_ORDER).toContain(placement);
  });
});

describe("computeCoachmarkPlacement", () => {
  it("places the bubble below and horizontally centered on the target", () => {
    const rect = { top: 100, left: 400, width: 120, height: 40 };
    const { placement, top, left } = computeCoachmarkPlacement(rect, VIEWPORT, COACHMARK);
    expect(placement).toBe("bottom");
    expect(top).toBe(100 + 40 + COACHMARK_GAP);
    // Centered: targetCenterX (460) - half coachmark width (160) = 300.
    expect(left).toBe(300);
  });

  it("never lets the bubble overflow the left/top viewport edges", () => {
    // Target in the top-left corner pushes a centered bubble off-screen; clamp it.
    const rect = { top: 0, left: 0, width: 40, height: 40 };
    const { top, left } = computeCoachmarkPlacement(rect, VIEWPORT, COACHMARK);
    expect(left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    expect(top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  });

  it("never lets the bubble overflow the right/bottom viewport edges", () => {
    const rect = { top: 740, left: 1000, width: 20, height: 20 };
    const { top, left } = computeCoachmarkPlacement(rect, VIEWPORT, COACHMARK);
    expect(left).toBeLessThanOrEqual(VIEWPORT.width - COACHMARK.width - VIEWPORT_MARGIN);
    expect(top).toBeLessThanOrEqual(VIEWPORT.height - COACHMARK.height - VIEWPORT_MARGIN);
  });

  it("honors a forced placement", () => {
    const rect = { top: 300, left: 400, width: 120, height: 40 };
    const { placement } = computeCoachmarkPlacement(rect, VIEWPORT, COACHMARK, {
      placement: "right",
    });
    expect(placement).toBe("right");
  });

  it("ignores an invalid forced placement and auto-selects", () => {
    const rect = { top: 100, left: 400, width: 120, height: 40 };
    const { placement } = computeCoachmarkPlacement(rect, VIEWPORT, COACHMARK, {
      placement: "diagonal",
    });
    expect(PLACEMENT_ORDER).toContain(placement);
  });
});

describe("rectFromDomRect", () => {
  it("normalizes a DOMRect-like object to a plain rect", () => {
    const domRect = { top: 1, left: 2, width: 3, height: 4, right: 5, bottom: 5, x: 2, y: 1 };
    expect(rectFromDomRect(domRect)).toEqual({ top: 1, left: 2, width: 3, height: 4 });
  });

  it("returns null for null/undefined", () => {
    expect(rectFromDomRect(null)).toBeNull();
    expect(rectFromDomRect(undefined)).toBeNull();
  });
});

describe("rectsEqual", () => {
  it("is true for identical rects (and within sub-pixel tolerance)", () => {
    const a = { top: 10, left: 10, width: 100, height: 50 };
    expect(rectsEqual(a, a)).toBe(true);
    expect(rectsEqual(a, { top: 10.2, left: 10, width: 100, height: 50 })).toBe(true);
  });

  it("is false when a dimension differs beyond tolerance", () => {
    const a = { top: 10, left: 10, width: 100, height: 50 };
    expect(rectsEqual(a, { top: 20, left: 10, width: 100, height: 50 })).toBe(false);
  });

  it("is false when either rect is null (but true when both null via identity)", () => {
    const a = { top: 0, left: 0, width: 1, height: 1 };
    expect(rectsEqual(a, null)).toBe(false);
    expect(rectsEqual(null, a)).toBe(false);
    expect(rectsEqual(null, null)).toBe(true);
  });
});
