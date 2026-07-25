import { describe, it, expect } from "vitest";
import { explainTankFlags } from "./flagExplain";
import { getWaterEnvelope } from "./tankUtils";

const FW = { id: 1, tankType: 0 };
const reading = (over) => ({ timestamp: 1000, temp: 24, ph: 7.0, ammonia: 0, nitrite: 0, nitrate: 5, ...over });

describe("explainTankFlags — grounded explanations", () => {
  it("a healthy tank produces no flags", () => {
    const { items, status } = explainTankFlags(FW, { readings: [reading()] });
    expect(items).toHaveLength(0);
    expect(status).toBe("ok");
  });

  it("targets always come from the envelope module, not literals", () => {
    const env = getWaterEnvelope(0);
    const { items } = explainTankFlags(FW, { readings: [reading({ ammonia: 0.5, nitrate: 40, temp: 30, ph: 5 })] });
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.ammonia.target).toBe(`\u2264 ${env.ammoniaMax} ppm`);
    expect(byId.nitrate.target).toBe(`\u2264 ${env.nitrateMax} ppm`);
    expect(byId.temp.target).toBe(`${env.tempMin}\u2013${env.tempMax}\u00b0C`);
    expect(byId.ph.target).toBe(`${env.phMin}\u2013${env.phMax}`);
  });

  it("observed values echo the actual reading (never invented)", () => {
    const { items } = explainTankFlags(FW, { readings: [reading({ ammonia: 0.25 })] });
    const ammonia = items.find((i) => i.id === "ammonia");
    expect(ammonia.observed).toBe("0.25 ppm");
    expect(ammonia.severity).toBe("alert");
  });

  it("temperature is directional (too warm vs too cold)", () => {
    const hot = explainTankFlags(FW, { readings: [reading({ temp: 30 })] }).items.find((i) => i.id === "temp");
    const cold = explainTankFlags(FW, { readings: [reading({ temp: 15 })] }).items.find((i) => i.id === "temp");
    expect(hot.label).toMatch(/warm/i);
    expect(cold.label).toMatch(/cold/i);
  });

  it("ammonia/nitrite are alert severity; nitrate/temp/pH are caution", () => {
    const { items } = explainTankFlags(FW, { readings: [reading({ ammonia: 0.5, nitrite: 0.3, nitrate: 40, temp: 30, ph: 5 })] });
    const sev = Object.fromEntries(items.map((i) => [i.id, i.severity]));
    expect(sev.ammonia).toBe("alert");
    expect(sev.nitrite).toBe("alert");
    expect(sev.nitrate).toBe("caution");
    expect(sev.temp).toBe("caution");
    expect(sev.ph).toBe("caution");
  });

  it("overdue schedules are explained with grounded guidance", () => {
    const nowSec = 1_000_000;
    const schedules = [
      { tankId: 1, kind: "waterChange", enabled: true, nextDueAt: nowSec - 3 * 86400, cadenceDays: 7 },
    ];
    const { items } = explainTankFlags(FW, {
      readings: [reading()],
      schedules,
      now: nowSec * 1000,
    });
    const sched = items.find((i) => i.id === "schedule:waterChange");
    expect(sched).toBeTruthy();
    expect(sched.observed).toMatch(/overdue/i);
    expect(sched.action.length).toBeGreaterThan(0);
    expect(sched.why.length).toBeGreaterThan(0);
  });

  it("brackish tank uses its own pH range in the target", () => {
    const brackish = { id: 2, tankType: 2 };
    const env = getWaterEnvelope(2);
    const { items } = explainTankFlags(brackish, { readings: [reading({ ph: 6.9 })] });
    const ph = items.find((i) => i.id === "ph");
    expect(ph.target).toBe(`${env.phMin}\u2013${env.phMax}`);
  });
});
