import { describe, it, expect } from "vitest";
import { buildTrendSeries } from "./ParamTrends";

describe("ParamTrends — buildTrendSeries", () => {
  it("extracts and sorts a normalized metric series by time", () => {
    const readings = [
      { timestamp: 300, temp: 25 },
      { timestamp: 100, temp: 24 },
      { timestamp: 200, temp: 26 },
    ];
    expect(buildTrendSeries(readings, "temp")).toEqual([
      { t: 100, v: 24 },
      { t: 200, v: 26 },
      { t: 300, v: 25 },
    ]);
  });

  it("normalizes on-chain scaled logs", () => {
    const readings = [{ timestamp: 1, tempCelsiusX10: 245, phX10: 72, nitratePpmX100: 500 }];
    expect(buildTrendSeries(readings, "temp")).toEqual([{ t: 1, v: 24.5 }]);
    expect(buildTrendSeries(readings, "ph")).toEqual([{ t: 1, v: 7.2 }]);
    expect(buildTrendSeries(readings, "nitrate")).toEqual([{ t: 1, v: 5 }]);
  });

  it("skips readings missing the metric", () => {
    const readings = [
      { timestamp: 1, temp: 24 },
      { timestamp: 2, ph: 7 }, // no temp
    ];
    expect(buildTrendSeries(readings, "temp")).toEqual([{ t: 1, v: 24 }]);
  });

  it("returns empty for no readings", () => {
    expect(buildTrendSeries([], "temp")).toEqual([]);
    expect(buildTrendSeries(null, "temp")).toEqual([]);
  });
});
