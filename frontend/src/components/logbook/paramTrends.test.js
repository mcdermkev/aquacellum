import { describe, it, expect } from "vitest";
import { buildTrendSeries, bucketAverageSeries } from "./ParamTrends";

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

describe("ParamTrends — bucketAverageSeries (rack aggregation)", () => {
  const DAY = 86400;

  it("averages same-day points from several tanks into one point per day", () => {
    // Day 0: two tanks read 24 and 26 → avg 25. Day 1: one tank reads 27.
    const series = [
      { t: 10, v: 24 },
      { t: 20, v: 26 },
      { t: DAY + 5, v: 27 },
    ];
    expect(bucketAverageSeries(series, DAY)).toEqual([
      { t: 0, v: 25 },
      { t: DAY, v: 27 },
    ]);
  });

  it("sorts buckets ascending regardless of input order", () => {
    const series = [
      { t: 2 * DAY + 1, v: 10 },
      { t: 5, v: 20 },
    ];
    const out = bucketAverageSeries(series, DAY);
    expect(out.map((p) => p.t)).toEqual([0, 2 * DAY]);
  });

  it("returns empty for empty/invalid input", () => {
    expect(bucketAverageSeries([], DAY)).toEqual([]);
    expect(bucketAverageSeries(null)).toEqual([]);
  });
});
