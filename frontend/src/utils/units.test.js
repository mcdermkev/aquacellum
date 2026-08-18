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
  formatVolume,
  litersToGallons,
  loadDistanceUnit,
  loadTempUnit,
  loadVolumeUnit,
  milesToKilometers,
  persistDistanceUnit,
  persistTempUnit,
  persistVolumeUnit,
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

// ─── Volume ──────────────────────────────────────────────────────────────────
//
// The reported bug: a keeper typed 20 into a field labelled "Volume (gal)" and
// their tank card read "76L". Storage in litres is correct — every write path
// multiplies by 3.78541 — but the display was hardcoded to match storage rather
// than the unit the keeper entered.
describe("formatVolume", () => {
  it("renders the gallons a keeper actually typed", () => {
    // 20 gal stores as round(20 * 3.78541) = 76 litres. That must come back as 20.
    expect(formatVolume(76, "gal")).toBe("20 gal");
    expect(formatVolume(38, "gal")).toBe("10 gal");
    expect(formatVolume(189, "gal")).toBe("50 gal");
  });

  it("renders litres when asked", () => {
    expect(formatVolume(76, "l")).toBe("76L");
    expect(formatVolume(49, "l")).toBe("49L");
  });

  it("defaults to gallons, matching every volume input in the app", () => {
    expect(formatVolume(76)).toBe("20 gal");
  });

  it("rounds gallons to whole numbers by default", () => {
    // Tanks are sold as round numbers. "20.1 gal" is false precision on a value
    // the keeper entered as 20.
    expect(formatVolume(76, "gal")).not.toContain(".");
    expect(formatVolume(76, "gal", { precision: 1 })).toBe("20.1 gal");
  });

  it("has a long form for prose", () => {
    expect(formatVolume(76, "gal", { long: true })).toBe("20 gallons");
    expect(formatVolume(76, "l", { long: true })).toBe("76 litres");
  });

  it("returns empty for a missing volume rather than a plausible zero", () => {
    // Same reasoning as temperature: "0 gal" is a readable-looking number and
    // would be confidently wrong about the tank. Absent stays absent.
    expect(formatVolume(null)).toBe("");
    expect(formatVolume(undefined)).toBe("");
    expect(formatVolume("")).toBe("");
    expect(formatVolume("abc")).toBe("");
  });

  it("still renders a genuine zero", () => {
    expect(formatVolume(0, "l")).toBe("0L");
    expect(formatVolume(0, "gal")).toBe("0 gal");
  });

  it("round-trips against the constant the write paths use", () => {
    // GAL_TO_L = 3.78541 is duplicated across BulkTankModal, FacilityTreeView,
    // parseTankCsv, growoutTank, breedingProgram and poseidonBridge. If the
    // display constant ever drifts from those, a keeper's entry stops matching
    // what they see back.
    for (const gal of [5, 10, 20, 29, 40, 55, 75, 125]) {
      const storedLiters = Math.round(gal * 3.78541);
      expect(formatVolume(storedLiters, "gal")).toBe(`${gal} gal`);
    }
  });

  it("falls back to gallons for an unrecognised unit", () => {
    expect(formatVolume(76, "furlongs")).toBe("20 gal");
  });
});

describe("volume preference persistence", () => {
  function fakeStorage(initial = {}) {
    const store = { ...initial };
    return {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      _store: store,
    };
  }

  it("defaults to gallons when nothing is stored", () => {
    expect(loadVolumeUnit(fakeStorage())).toBe("gal");
  });

  it("reads a stored preference", () => {
    expect(loadVolumeUnit(fakeStorage({ aquadex_volume_unit: "l" }))).toBe("l");
  });

  it("ignores a junk stored value rather than rendering an unknown unit", () => {
    expect(loadVolumeUnit(fakeStorage({ aquadex_volume_unit: "quarts" }))).toBe("gal");
  });

  it("persists only valid units", () => {
    const s = fakeStorage();
    persistVolumeUnit("l", s);
    expect(s._store.aquadex_volume_unit).toBe("l");

    persistVolumeUnit("hogsheads", s);
    expect(s._store.aquadex_volume_unit).toBe("l"); // unchanged
  });

  it("survives storage throwing", () => {
    const hostile = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadVolumeUnit(hostile)).toBe("gal");
    expect(() => persistVolumeUnit("l", hostile)).not.toThrow();
  });
});
