/**
 * The grow-out survival funnel (docs/BREEDER_STATE_MODEL.md §7).
 *
 * This math was duplicated across four files with four slightly different
 * shapes. Extracting it matters for a specific reason: adding a checkpoint type
 * meant editing four places, and missing one produced a *silent accounting
 * error* — the funnel just quietly stopped adding up — rather than a crash.
 *
 * These tests pin the existing definitions exactly, including the one that's
 * arguably wrong (§9.21, culls not counting against survival), because every
 * displayed number and achievement threshold is calibrated to them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  COUNTED_TYPES,
  DEPARTURE_TYPES,
  NON_COUNTING_TYPES,
  aggregateGrowout,
  buildGrowoutTimeline,
  isCountingCheckpoint,
  summarizeGrowout,
} from "../utils/growoutFunnel";

const cp = (type, count, timestamp = 1000) => ({ type, count, timestamp });

describe("summarizeGrowout", () => {
  it("takes the HIGHEST fry count, not the sum — it's a headcount", () => {
    const s = summarizeGrowout([cp("fry_count", 40, 1), cp("fry_count", 38, 2)]);
    expect(s.fry).toBe(40);
  });

  it("sums departures and floors alive at zero", () => {
    const s = summarizeGrowout([
      cp("fry_count", 100),
      cp("loss", 10),
      cp("cull", 5),
      cp("sold", 20),
    ]);
    expect(s.lost).toBe(10);
    expect(s.culled).toBe(5);
    expect(s.sold).toBe(20);
    expect(s.departed).toBe(35);
    expect(s.alive).toBe(65);
  });

  it("never reports a negative population even if the logs over-account", () => {
    const s = summarizeGrowout([cp("fry_count", 10), cp("loss", 50)]);
    expect(s.alive).toBe(0);
  });

  it("computes survival as (fry − lost) / fry — culls and sales excluded", () => {
    // Preserving the pre-existing product definition; see §9.21.
    const s = summarizeGrowout([cp("fry_count", 100), cp("loss", 10), cp("cull", 30), cp("sold", 20)]);
    expect(s.survivalRate).toBe(90);
  });

  it("reports survival as null — not 0% — when no fry count exists yet", () => {
    // A brand-new spawn must read "unknown", never "0% survived".
    expect(summarizeGrowout([]).survivalRate).toBeNull();
    expect(summarizeGrowout([cp("note", 0)]).survivalRate).toBeNull();
  });

  it("excludes commentary rows from the counts and the checkpoint tally", () => {
    const s = summarizeGrowout([
      cp("fry_count", 20),
      cp("note", 999),
      cp("narration", 999),
    ]);
    expect(s.fry).toBe(20);
    expect(s.checkpointCount).toBe(1);
  });

  it("does NOT treat 'moved' as a departure — relocating isn't removing", () => {
    const s = summarizeGrowout([cp("fry_count", 30), cp("moved", 30)]);
    expect(s.alive).toBe(30);
    expect(s.departed).toBe(0);
    expect(DEPARTURE_TYPES).not.toContain("moved");
    expect(COUNTED_TYPES).toContain("moved");
  });

  it("tracks the most recent checkpoint time for overdue nudges", () => {
    const s = summarizeGrowout([cp("fry_count", 5, 100), cp("loss", 1, 500)]);
    expect(s.lastCheckpointAt).toBe(500);
    expect(summarizeGrowout([]).lastCheckpointAt).toBeNull();
  });

  it("carries the cohort's starting size through", () => {
    expect(summarizeGrowout([], { eggCount: 200 }).eggs).toBe(200);
  });

  it("tolerates junk input", () => {
    for (const junk of [null, undefined, "nope", 42, {}]) {
      expect(() => summarizeGrowout(junk)).not.toThrow();
      expect(summarizeGrowout(junk).fry).toBe(0);
    }
  });

  it("coerces non-numeric counts rather than producing NaN", () => {
    const s = summarizeGrowout([cp("fry_count", "40"), cp("loss", null), cp("cull", undefined)]);
    expect(s.fry).toBe(40);
    expect(s.alive).toBe(40);
    expect(Number.isNaN(s.alive)).toBe(false);
  });

  it("classifies checkpoint types consistently", () => {
    expect(isCountingCheckpoint(cp("fry_count", 1))).toBe(true);
    for (const type of NON_COUNTING_TYPES) {
      expect(isCountingCheckpoint(cp(type, 1)), type).toBe(false);
    }
    expect(isCountingCheckpoint(null)).toBe(false);
  });
});

describe("aggregateGrowout", () => {
  const spawns = [
    { checkpoints: [cp("fry_count", 100), cp("loss", 10), cp("sold", 30)], eggCount: 120 },
    { checkpoints: [cp("fry_count", 50), cp("loss", 25)], eggCount: 60 },
  ];

  it("sums living fry across spawns", () => {
    expect(aggregateGrowout(spawns).totalAlive).toBe(60 + 25);
  });

  it("names the self-reported sold total so it can't be mistaken for sales", () => {
    const agg = aggregateGrowout(spawns);
    expect(agg.totalSoldSelfReported).toBe(30);
    // The field name is the guardrail — there is no bare `totalSold`.
    expect(agg.totalSold).toBeUndefined();
  });

  it("reports the BEST survival rate, ignoring spawns with no data", () => {
    const agg = aggregateGrowout([...spawns, { checkpoints: [], eggCount: 0 }]);
    expect(agg.bestSurvivalRate).toBe(90);
  });

  it("handles an empty or junk list", () => {
    for (const junk of [[], null, undefined]) {
      const agg = aggregateGrowout(junk);
      expect(agg.spawnCount).toBe(0);
      expect(agg.bestSurvivalRate).toBe(0);
    }
  });
});

describe("buildGrowoutTimeline", () => {
  it("accumulates in chronological order regardless of input order", () => {
    const points = buildGrowoutTimeline([
      cp("loss", 5, 300),
      cp("fry_count", 40, 100),
      cp("sold", 10, 200),
    ], 0);
    expect(points.map((p) => p.timestamp)).toEqual([100, 200, 300]);
    expect(points[0].alive).toBe(40);
    expect(points[1].alive).toBe(30);
    expect(points[2].alive).toBe(25);
  });

  it("skips commentary so the line only moves on real population changes", () => {
    const points = buildGrowoutTimeline([cp("fry_count", 10, 1), cp("note", 0, 2)], 0);
    expect(points).toHaveLength(1);
  });

  it("seeds from the egg count when no fry count has been logged", () => {
    const points = buildGrowoutTimeline([cp("loss", 2, 10)], 50);
    expect(points[0].maxFry).toBe(50);
    expect(points[0].alive).toBe(48);
  });

  it("returns nothing for an empty or junk series", () => {
    for (const junk of [[], null, undefined, [cp("narration", 0)]]) {
      expect(buildGrowoutTimeline(junk, 0)).toEqual([]);
    }
  });

  it("agrees with summarizeGrowout at the final point", () => {
    const series = [cp("fry_count", 80, 1), cp("cull", 6, 2), cp("sold", 14, 3), cp("loss", 10, 4)];
    const points = buildGrowoutTimeline(series, 100);
    const summary = summarizeGrowout(series, { eggCount: 100 });
    const last = points[points.length - 1];
    expect(last.alive).toBe(summary.alive);
    expect(last.survivalRate).toBe(summary.survivalRate);
  });
});

describe("all four former copies now consume the shared module", () => {
  function code(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  const CONSUMERS = [
    "../components/SpawnGrowoutTracker.jsx",
    "../components/BatchGrowOutPanel.jsx",
    "../components/GrowOutChart.jsx",
    "../services/breederStats.js",
  ];

  it("each imports from growoutFunnel", () => {
    for (const file of CONSUMERS) {
      expect(code(file), file).toContain("growoutFunnel");
    }
  });

  it("none re-implements the fry_count / cull / sold / loss reduction inline", () => {
    for (const file of CONSUMERS) {
      const src = code(file);
      expect(src, file).not.toMatch(/filter\(\s*c\s*=>\s*c\.type\s*===\s*["']cull["']\s*\)/);
      expect(src, file).not.toMatch(/type\s*===\s*["']fry_count["'][\s\S]{0,120}Math\.max/);
    }
  });
});
