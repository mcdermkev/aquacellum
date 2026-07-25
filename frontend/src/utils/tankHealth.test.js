import { describe, it, expect } from "vitest";
import { getWaterEnvelope, evaluateReading, tankTypeLabel, tankTypeIcon, NITROGEN_LIMITS } from "./tankUtils";
import { scoreToAmbient, normalizeReading, deriveTankHealth } from "./tankHealth";

describe("tankUtils — envelopes & saltwater removal", () => {
  it("freshwater (0) envelope carries temp/pH + nitrogen limits", () => {
    const env = getWaterEnvelope(0);
    expect(env).toMatchObject({ tempMin: 22, tempMax: 26, phMin: 6.5, phMax: 7.8 });
    expect(env.ammoniaMax).toBe(NITROGEN_LIMITS.ammoniaMax);
    expect(env.nitrateMax).toBe(20);
  });

  it("reserved saltwater index (1) falls back to freshwater", () => {
    expect(getWaterEnvelope(1)).toEqual(getWaterEnvelope(0));
    expect(tankTypeLabel(1)).toBe("Freshwater");
    expect(tankTypeIcon(1)).toBe("💧");
  });

  it("brackish (2) and pond (3) have their own ranges", () => {
    expect(getWaterEnvelope(2)).toMatchObject({ phMin: 7.2, phMax: 8.2 });
    expect(getWaterEnvelope(3)).toMatchObject({ tempMin: 10, tempMax: 28 });
  });

  it("unknown type falls back to freshwater", () => {
    expect(getWaterEnvelope(99)).toEqual(getWaterEnvelope(0));
  });

  it("evaluateReading flags out-of-range values only", () => {
    const good = evaluateReading(0, { temp: 24, ph: 7.0, ammonia: 0, nitrite: 0, nitrate: 5 });
    expect(good.flags).toHaveLength(0);
    const bad = evaluateReading(0, { temp: 30, ph: 5.0, ammonia: 0.5, nitrite: 0.2, nitrate: 40 });
    expect(bad.ammoniaOk).toBe(false);
    expect(bad.flags.length).toBe(5);
  });
});

describe("tankHealth — scoreToAmbient", () => {
  it("maps score to status thresholds", () => {
    expect(scoreToAmbient(85).status).toBe("ok");
    expect(scoreToAmbient(52).status).toBe("drifting");
    expect(scoreToAmbient(20).status).toBe("alert");
  });
  it("clarity and liveliness rise with score", () => {
    expect(scoreToAmbient(100).clarity).toBeGreaterThan(scoreToAmbient(0).clarity);
    expect(scoreToAmbient(100).liveliness).toBeGreaterThan(scoreToAmbient(0).liveliness);
    expect(scoreToAmbient(0).tint).toBeGreaterThan(scoreToAmbient(100).tint);
  });
});

describe("tankHealth — normalizeReading", () => {
  it("normalizes on-chain scaled logs", () => {
    const n = normalizeReading({ tempCelsiusX10: 245, phX10: 72, ammoniaPpmX100: 5, nitritePpmX100: 0, nitratePpmX100: 500, timestamp: 100 });
    expect(n.temp).toBeCloseTo(24.5);
    expect(n.ph).toBeCloseTo(7.2);
    expect(n.ammonia).toBeCloseTo(0.05);
    expect(n.nitrate).toBeCloseTo(5.0);
  });
  it("passes through already-normalized readings", () => {
    const n = normalizeReading({ temp: 25, ph: 7.1 });
    expect(n.temp).toBe(25);
    expect(n.ph).toBe(7.1);
  });
  it("returns null for empty readings", () => {
    expect(normalizeReading(null)).toBeNull();
    expect(normalizeReading({})).toBeNull();
  });
});

describe("tankHealth — deriveTankHealth", () => {
  const healthyReading = { temp: 24, ph: 7.0, ammonia: 0, nitrite: 0, nitrate: 5, timestamp: 1000 };

  it("healthy tank with good readings → ok", () => {
    const h = deriveTankHealth({ tankType: 0 }, { readings: [healthyReading] });
    expect(h.status).toBe("ok");
    expect(h.flags).toHaveLength(0);
    expect(h.score).toBeGreaterThanOrEqual(90);
  });

  it("high ammonia → alert", () => {
    const h = deriveTankHealth({ tankType: 0 }, { readings: [{ ...healthyReading, ammonia: 0.5 }] });
    expect(h.status).toBe("alert");
    expect(h.flags.some((f) => f.toLowerCase().includes("ammonia"))).toBe(true);
  });

  it("overdue schedules lower the score and appear in flags", () => {
    const now = Date.now();
    const dueAt = Math.round(now / 1000) - 3 * 86400; // 3 days overdue
    const h = deriveTankHealth(
      { tankType: 0 },
      { readings: [healthyReading], schedules: [{ kind: "waterChange", nextDueAt: dueAt, enabled: true }], now }
    );
    expect(h.overdue).toHaveLength(1);
    expect(h.overdue[0].daysOverdue).toBe(3);
    expect(h.score).toBeLessThan(100);
    expect(h.flags.some((f) => f.toLowerCase().includes("water change"))).toBe(true);
  });

  it("never-tested tank is not scored as perfect", () => {
    const h = deriveTankHealth({ tankType: 0 }, {});
    expect(h.score).toBeLessThanOrEqual(82);
    expect(h.latest).toBeNull();
  });

  it("falls back to tank.latestLog when no readings array", () => {
    const h = deriveTankHealth({ tankType: 0, latestLog: { tempCelsiusX10: 245, phX10: 70, ammoniaPpmX100: 0, nitritePpmX100: 0, nitratePpmX100: 500, timestamp: 1 } });
    expect(h.latest).not.toBeNull();
    expect(h.status).toBe("ok");
  });
});
