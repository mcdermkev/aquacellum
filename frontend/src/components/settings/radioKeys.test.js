import { describe, it, expect } from "vitest";
import { nextRadioIndex } from "./radioKeys";

describe("nextRadioIndex (radio group arrow keys)", () => {
  it("moves forward with ArrowDown and ArrowRight", () => {
    expect(nextRadioIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextRadioIndex("ArrowRight", 1, 3)).toBe(2);
  });

  it("moves back with ArrowUp and ArrowLeft", () => {
    expect(nextRadioIndex("ArrowUp", 2, 3)).toBe(1);
    expect(nextRadioIndex("ArrowLeft", 1, 3)).toBe(0);
  });

  it("wraps around at both ends", () => {
    expect(nextRadioIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextRadioIndex("ArrowRight", 2, 3)).toBe(0);
    expect(nextRadioIndex("ArrowUp", 0, 3)).toBe(2);
    expect(nextRadioIndex("ArrowLeft", 0, 3)).toBe(2);
  });

  it("jumps to the first and last option with Home and End", () => {
    expect(nextRadioIndex("Home", 2, 4)).toBe(0);
    expect(nextRadioIndex("End", 0, 4)).toBe(3);
  });

  it("ignores keys that are not navigation keys", () => {
    for (const key of ["Enter", " ", "Tab", "a", "Escape", "PageDown"]) {
      expect(nextRadioIndex(key, 1, 3)).toBeNull();
    }
  });

  it("returns null for an empty group and treats a bad index as the first option", () => {
    expect(nextRadioIndex("ArrowDown", 0, 0)).toBeNull();
    expect(nextRadioIndex("ArrowDown", -1, 3)).toBe(1);
    expect(nextRadioIndex("ArrowUp", 9, 3)).toBe(2);
  });

  it("stays on the only option in a group of one", () => {
    expect(nextRadioIndex("ArrowDown", 0, 1)).toBe(0);
    expect(nextRadioIndex("End", 0, 1)).toBe(0);
  });
});
