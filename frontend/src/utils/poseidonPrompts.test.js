import { describe, it, expect } from "vitest";
import { buildFlagFixPrompt, buildSpeciesCarePrompt } from "./poseidonPrompts";

const FW = { tankType: 0 };
const BRACKISH = { tankType: 2 };

describe("buildFlagFixPrompt", () => {
  it("frames a benign question when there are no flags", () => {
    const p = buildFlagFixPrompt(FW, []);
    expect(p).toMatch(/healthy/i);
    expect(p).toMatch(/freshwater/i);
  });

  it("includes each flag's observed value and target (grounded, verbatim)", () => {
    const items = [
      { label: "Ammonia too high", observed: "0.25 ppm", target: "\u2264 0.05 ppm" },
      { label: "Nitrate above target", observed: "30.0 ppm", target: "\u2264 20 ppm" },
    ];
    const p = buildFlagFixPrompt(FW, items);
    expect(p).toContain("Ammonia too high (0.25 ppm, target \u2264 0.05 ppm)");
    expect(p).toContain("Nitrate above target (30.0 ppm, target \u2264 20 ppm)");
    // Instructs the model to stay grounded to the provided readings.
    expect(p).toMatch(/only on these readings/i);
  });

  it("reflects the tank type in the question", () => {
    const p = buildFlagFixPrompt(BRACKISH, [{ label: "pH below range", observed: "6.9", target: "7.2\u20138.2" }]);
    expect(p).toMatch(/brackish/i);
  });

  it("does not invent numbers beyond the provided items", () => {
    const items = [{ label: "Water too warm", observed: "30.0\u00b0C", target: "22\u201326\u00b0C" }];
    const p = buildFlagFixPrompt(FW, items);
    // Only the numbers we passed should appear.
    const nums = p.match(/\d+(?:\.\d+)?/g) || [];
    expect(nums.sort()).toEqual(["22", "26", "30.0"].sort());
  });
});

describe("buildSpeciesCarePrompt", () => {
  it("names the species and tank type", () => {
    const p = buildSpeciesCarePrompt("Neon Tetra", FW);
    expect(p).toContain("Neon Tetra");
    expect(p).toMatch(/freshwater/i);
  });

  it("falls back gracefully when no name is given", () => {
    const p = buildSpeciesCarePrompt("", FW);
    expect(p).toMatch(/this species/i);
  });
});
