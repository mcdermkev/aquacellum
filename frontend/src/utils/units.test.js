/**
 * Unit tests for utils/units.js (Settings Phase 4a, docs/SETTINGS_SPEC.md §6 #5).
 *
 * Two things carry real risk here and both are pinned below:
 *
 *   1. BUG-COMPATIBILITY with the pre-existing `aquadex_distance_unit` key.
 *      `LocalBreederMap` wrote the literal strings "mi"/"km". If this module
 *      reinterpreted those values, a user's saved "km" would silently flip back
 *      to miles.
 *   2. THE "both" DEFAULT BEING A NO-OP. Temperature is currently rendered as
 *      both scales at every call site. If the default formatted differently from
 *      the hardcoded strings it replaced, adding this preference would visibly
 *      change the logbook for every user who never opened Settings.
 *
 * Pure functions with injectable storage, per the useHighContrast.js precedent —
 * this repo's vitest runs in a `node` environment with no DOM.
 */

import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_DISTANCE_UNIT,
  DEFAULT_TEMP_UNIT,
  DISTANCE_UNIT_KEY,
  TEMP_UNIT_KEY,
  celsiusToFahrenheit,
  formatDistance,
  formatTemperature,
  loadDistanceUnit,
  loadTempUnit,
  milesToKilometers,
  persistDistanceUnit,
  persistTempUnit,
  showCelsius,
  showFahrenheit,
} from "./units.js";

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: vi.fn((key) => (key in store ? store[key] : null)),
    setItem: vi.fn((key, value) => { store[key] = value; }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    _store: store,
  };
}

function throwingStorage() {
  return {
    getItem: vi.fn(() => { throw new Error("SecurityError"); }),
    setItem: vi.fn(() => { throw new Error("QuotaExceededError"); }),
  };
}

describe("defaults", () => {
  it("defaults distance to miles and temperature to both", () => {
    expect(DEFAULT_DISTANCE_UNIT).toBe("mi");
    expect(DEFAULT_TEMP_UNIT).toBe("both");
  });

  it("falls back to the defaults when nothing is stored", () => {
    const storage = fakeStorage();
    expect(loadDistanceUnit(storage)).toBe("mi");
    expect(loadTempUnit(storage)).toBe("both");
  });

  it("falls back to the defaults when storage throws or is absent", () => {
    expect(loadDistanceUnit(throwingStorage())).toBe("mi");
    expect(loadTempUnit(throwingStorage())).toBe("both");
    expect(loadDistanceUnit(null)).toBe("mi");
    expect(loadTempUnit(null)).toBe("both");
  });

  it("ignores a stored value that is not a known unit", () => {
    // Fail safe rather than propagating junk into a formatter.
    expect(loadDistanceUnit(fakeStorage({ [DISTANCE_UNIT_KEY]: "furlongs" }))).toBe("mi");
    expect(loadTempUnit(fakeStorage({ [TEMP_UNIT_KEY]: "kelvin" }))).toBe("both");
  });
});

describe("compatibility with the pre-existing aquadex_distance_unit values", () => {
  it("reads the exact strings LocalBreederMap wrote", () => {
    // LocalBreederMap.jsx: localStorage.setItem("aquadex_distance_unit", useMetric ? "km" : "mi")
    expect(loadDistanceUnit(fakeStorage({ [DISTANCE_UNIT_KEY]: "km" }))).toBe("km");
    expect(loadDistanceUnit(fakeStorage({ [DISTANCE_UNIT_KEY]: "mi" }))).toBe("mi");
  });

  it("writes the same strings back", () => {
    const storage = fakeStorage();
    persistDistanceUnit("km", storage);
    expect(storage._store[DISTANCE_UNIT_KEY]).toBe("km");
    persistDistanceUnit("mi", storage);
    expect(storage._store[DISTANCE_UNIT_KEY]).toBe("mi");
  });

  it("refuses to persist an unknown unit rather than corrupting the key", () => {
    const storage = fakeStorage({ [DISTANCE_UNIT_KEY]: "km" });
    persistDistanceUnit("furlongs", storage);
    expect(storage._store[DISTANCE_UNIT_KEY]).toBe("km");
    const tempStore = fakeStorage({ [TEMP_UNIT_KEY]: "c" });
    persistTempUnit("kelvin", tempStore);
    expect(tempStore._store[TEMP_UNIT_KEY]).toBe("c");
  });

  it("does not throw when storage rejects the write", () => {
    expect(() => persistDistanceUnit("km", throwingStorage())).not.toThrow();
    expect(() => persistTempUnit("c", throwingStorage())).not.toThrow();
    expect(() => persistDistanceUnit("km", null)).not.toThrow();
  });
});

describe("conversion", () => {
  it("converts celsius to fahrenheit", () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
    expect(celsiusToFahrenheit(24.5)).toBeCloseTo(76.1, 5);
  });

  it("converts miles to kilometres", () => {
    expect(milesToKilometers(1)).toBeCloseTo(1.60934, 5);
    expect(milesToKilometers(0)).toBe(0);
  });
});

describe("formatDistance", () => {
  it("formats miles without converting", () => {
    expect(formatDistance(12.4, "mi")).toBe("12.4 mi");
  });

  it("converts when kilometres are selected", () => {
    expect(formatDistance(20, "km", { precision: 1 })).toBe("32.2 km");
  });

  it("honours precision, so whole-number radii read naturally", () => {
    // The zone card shows a 20-mile radius; "20.0 mi" would be noise.
    expect(formatDistance(20, "mi", { precision: 0 })).toBe("20 mi");
    expect(formatDistance(20, "km", { precision: 0 })).toBe("32 km");
  });

  it("returns an empty string for absent or non-numeric input instead of 0 or NaN", () => {
    // `Number(null)` and `Number("")` are both 0, so an absent distance would
    // otherwise render as a confident "0.0 mi".
    expect(formatDistance(undefined, "mi")).toBe("");
    expect(formatDistance(null, "mi")).toBe("");
    expect(formatDistance("", "mi")).toBe("");
    expect(formatDistance("abc", "mi")).toBe("");
    expect(formatDistance(NaN, "mi")).toBe("");
  });

  it("still formats a genuine zero", () => {
    // Absent and zero are different facts and must render differently.
    expect(formatDistance(0, "mi")).toBe("0.0 mi");
  });

  it("accepts a numeric string, since stored values are not always typed", () => {
    expect(formatDistance("12.4", "mi")).toBe("12.4 mi");
  });

  it("defaults to miles when no unit is passed", () => {
    expect(formatDistance(5)).toBe("5.0 mi");
  });
});

describe("temperature display predicates", () => {
  it("shows both readings under the default", () => {
    expect(showCelsius("both")).toBe(true);
    expect(showFahrenheit("both")).toBe(true);
  });

  it("shows exactly one reading for a single-unit choice", () => {
    expect(showCelsius("c")).toBe(true);
    expect(showFahrenheit("c")).toBe(false);
    expect(showCelsius("f")).toBe(false);
    expect(showFahrenheit("f")).toBe(true);
  });

  it("defaults to both when called with no argument", () => {
    expect(showCelsius()).toBe(true);
    expect(showFahrenheit()).toBe(true);
  });
});

describe("formatTemperature", () => {
  it("reproduces the ActivityLog string exactly under the default", () => {
    // Was hardcoded as:
    //   `${(t/10).toFixed(1)}°C (${((t/10)*9/5+32).toFixed(1)}°F)`
    // Adding the preference must not change this for anyone who never opens Settings.
    expect(formatTemperature(24.5, "both", { parenthesizeSecond: true })).toBe("24.5°C (76.1°F)");
  });

  it("reproduces the TankList telemetry string under the default", () => {
    expect(formatTemperature(24.5, "both")).toBe("24.5°C / 76.1°F");
  });

  it("emits a single reading when one unit is chosen", () => {
    expect(formatTemperature(24.5, "c")).toBe("24.5°C");
    expect(formatTemperature(24.5, "f")).toBe("76.1°F");
  });

  it("does not parenthesize when there is no second reading to wrap", () => {
    expect(formatTemperature(24.5, "c", { parenthesizeSecond: true })).toBe("24.5°C");
    expect(formatTemperature(24.5, "f", { parenthesizeSecond: true })).toBe("76.1°F");
  });

  it("honours a custom separator and precision", () => {
    expect(formatTemperature(24.5, "both", { separator: " | " })).toBe("24.5°C | 76.1°F");
    expect(formatTemperature(24.5, "c", { precision: 0 })).toBe("25°C");
  });

  it("returns an empty string for absent input rather than a plausible 0°C", () => {
    // The important case. A tank with no logged temperature must render blank,
    // not "0.0°C (32.0°F)" — which looks like a real, alarming reading.
    expect(formatTemperature(undefined, "both")).toBe("");
    expect(formatTemperature(null, "c")).toBe("");
    expect(formatTemperature("", "both")).toBe("");
    expect(formatTemperature(NaN, "both")).toBe("");
  });

  it("handles negatives and a genuine zero", () => {
    // 0°C is a real reading and must still format; only ABSENT values blank out.
    expect(formatTemperature(0, "both")).toBe("0.0°C / 32.0°F");
    expect(formatTemperature(-5, "f")).toBe("23.0°F");
  });
});
