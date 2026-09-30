/**
 * Tank posts attach only real readings. The composer used to fall back to
 * "24.5°C" and "7.2 pH" for a tank with no water test, and 7 public Reef posts
 * went out with those invented numbers.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { latestReading, readingSummary } from "../components/logbook/latestReading";

describe("latestReading", () => {
  it("no logs means no reading, never a default", () => {
    for (const logs of [undefined, null, [], [{ timestamp: 5, note: "fed" }]]) {
      const r = latestReading(logs);
      expect(r).toEqual({ temp: null, ph: null, tempText: null, phText: null, hasReading: false });
      expect(readingSummary(r)).toBeNull();
    }
  });

  it("reads the newest log that has a value, in both storage shapes", () => {
    const r = latestReading([
      { timestamp: 1, tempCelsiusX10: 240, phX10: 70 },
      { timestamp: 3, note: "water change" },
      { timestamp: 2, temp: 262, ph: 68 },
    ]);
    expect(r).toMatchObject({ temp: 26.2, ph: 6.8, tempText: "26.2°C", phText: "6.8", hasReading: true });
    expect(readingSummary(r)).toBe("26.2°C, pH 6.8");
  });

  it("keeps a half reading half", () => {
    const r = latestReading([{ timestamp: 1, tempCelsiusX10: 250 }]);
    expect(r.ph).toBeNull();
    expect(readingSummary(r)).toBe("25.0°C");
  });
});

describe("TankList posts carry no invented values", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/TankList.jsx", import.meta.url)), "utf8");
  it("no hardcoded fallback readings or canned claims", () => {
    expect(src).not.toMatch(/"24\.5°C"|"7\.2 pH"|: 245\)|: 72\)/);
    expect(src).not.toMatch(/EXPERT LAB AUDIT|Parameters are stable|SPAWNING EVENT: Spawn log recorded/);
    expect(src).toMatch(/latestReading\(activeTank\.logs\)/);
  });
});
