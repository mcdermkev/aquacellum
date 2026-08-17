/**
 * The horizontal-scroll edge affordance (hooks/useScrollAffordance.js).
 *
 * WHY THIS TEST EXISTS. Beta feedback said tab bars gave no hint that more tabs
 * existed off-screen. The main nav *did* already have a fade — driven by an inline
 * ref in App.jsx with the right-edge condition inverted:
 *
 *     el.classList.toggle("aquadex-nav--scrolled-end",
 *       el.scrollLeft >= el.scrollWidth - el.clientWidth - 10);
 *
 * That is true when you have REACHED the end, and it was what showed the
 * right-hand fade. So the "there is more this way" cue was present only when
 * there was nothing more, and absent at rest — the exact state a first-time user
 * lands on. Invisible, one character of logic, and untestable where it lived.
 *
 * So the decision is now a pure function and these are the tests that pin the
 * DIRECTION of each branch. Everything else about the feature is cosmetic; this
 * is the part that can be silently wrong.
 */
import { describe, it, expect } from "vitest";
import { resolveScrollEdges, EDGE_TOLERANCE } from "../hooks/useScrollAffordance";

// A bar 600px of content wide in a 300px viewport => 300px of scroll range.
const overflowing = (scrollLeft) => ({ scrollLeft, scrollWidth: 600, clientWidth: 300 });

describe("resolveScrollEdges", () => {
  it("reports nothing when the content fits", () => {
    expect(resolveScrollEdges({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toBe("none");
  });

  it("reports nothing when the content is NARROWER than the container", () => {
    // Guards against a negative maxScroll being treated as scrollable.
    expect(resolveScrollEdges({ scrollLeft: 0, scrollWidth: 120, clientWidth: 300 })).toBe("none");
  });

  it("THE REGRESSION: at rest, points to the content on the RIGHT", () => {
    // The old code produced no right-hand cue here. This is the whole bug.
    expect(resolveScrollEdges(overflowing(0))).toBe("end");
  });

  it("points LEFT once scrolled fully to the right", () => {
    expect(resolveScrollEdges(overflowing(300))).toBe("start");
  });

  it("points BOTH ways mid-scroll", () => {
    expect(resolveScrollEdges(overflowing(150))).toBe("both");
  });

  it("never reports 'both' at either extreme", () => {
    // A fade that persists at an end is worse than none: reaching the last tab
    // then never confirms you have seen everything.
    expect(resolveScrollEdges(overflowing(0))).not.toBe("both");
    expect(resolveScrollEdges(overflowing(300))).not.toBe("both");
  });

  describe("subpixel tolerance", () => {
    it("treats a hair off the start as the start", () => {
      // Fractional layout and browser zoom mean scrollLeft rarely lands on 0.
      expect(resolveScrollEdges(overflowing(EDGE_TOLERANCE))).toBe("end");
    });

    it("treats a hair off the end as the end", () => {
      expect(resolveScrollEdges(overflowing(300 - EDGE_TOLERANCE))).toBe("start");
    });

    it("still reports 'both' just past the tolerance", () => {
      expect(resolveScrollEdges(overflowing(EDGE_TOLERANCE + 1))).toBe("both");
      expect(resolveScrollEdges(overflowing(300 - EDGE_TOLERANCE - 1))).toBe("both");
    });

    it("ignores an overflow smaller than the tolerance", () => {
      // A container over by a rounding error must not advertise a scroll that
      // cannot actually happen.
      expect(
        resolveScrollEdges({ scrollLeft: 0, scrollWidth: 300 + EDGE_TOLERANCE, clientWidth: 300 })
      ).toBe("none");
    });
  });

  it("returns one of exactly four states for a wide sweep of positions", () => {
    const allowed = new Set(["none", "start", "end", "both"]);
    for (let left = -20; left <= 320; left += 1) {
      expect(allowed.has(resolveScrollEdges(overflowing(left)))).toBe(true);
    }
  });

  it("is monotonic: end -> both -> start as you scroll right, with no flapping", () => {
    // Reading the sequence of states across a full scroll catches an off-by-one
    // that would otherwise only show as a flickering fade on a real device.
    const seen = [];
    for (let left = 0; left <= 300; left += 5) {
      const state = resolveScrollEdges(overflowing(left));
      if (seen[seen.length - 1] !== state) seen.push(state);
    }
    expect(seen).toEqual(["end", "both", "start"]);
  });
});
