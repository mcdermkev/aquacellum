import { describe, it, expect } from "vitest";
import { nextTabIndex } from "./breedGalleryTabs";

describe("nextTabIndex", () => {
  it("moves right and wraps from the last tab to the first", () => {
    expect(nextTabIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextTabIndex("ArrowRight", 2, 3)).toBe(0);
  });

  it("moves left and wraps from the first tab to the last", () => {
    expect(nextTabIndex("ArrowLeft", 2, 3)).toBe(1);
    expect(nextTabIndex("ArrowLeft", 0, 3)).toBe(2);
  });

  it("jumps to the first tab on Home and the last on End", () => {
    expect(nextTabIndex("Home", 2, 4)).toBe(0);
    expect(nextTabIndex("End", 0, 4)).toBe(3);
  });

  it("ignores other keys", () => {
    for (const key of ["Enter", " ", "Tab", "ArrowUp", "ArrowDown", "a"]) {
      expect(nextTabIndex(key, 1, 3)).toBeNull();
    }
  });

  it("returns null when there are no tabs", () => {
    expect(nextTabIndex("ArrowRight", 0, 0)).toBeNull();
    expect(nextTabIndex("Home", 0, -1)).toBeNull();
  });

  it("treats a negative index (nothing selected) as the first tab", () => {
    expect(nextTabIndex("ArrowRight", -1, 3)).toBe(1);
    expect(nextTabIndex("ArrowLeft", -1, 3)).toBe(2);
    expect(nextTabIndex("End", -1, 3)).toBe(2);
  });

  it("stays on the only tab when there is one", () => {
    expect(nextTabIndex("ArrowRight", 0, 1)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 1)).toBe(0);
  });
});
