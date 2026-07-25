import { describe, it, expect } from "vitest";
import { pickSuggestion } from "./CareCoach";

const NOW = 1_700_000_000_000; // fixed ms
const secAgo = (days) => NOW / 1000 - days * 86400;

const healthyLog = { tempCelsiusX10: 245, phX10: 70, ammoniaPpmX100: 0, nitritePpmX100: 0, nitratePpmX100: 500, timestamp: 1 };
const ammoniaLog = { tempCelsiusX10: 245, phX10: 70, ammoniaPpmX100: 50, nitritePpmX100: 0, nitratePpmX100: 500, timestamp: 1 };

describe("CareCoach — pickSuggestion (habit engine)", () => {
  it("emergency water first when ammonia/nitrite detected", () => {
    const s = pickSuggestion({ tankType: 0, latestLog: ammoniaLog, latestTestTimestamp: secAgo(0), latestChangeTimestamp: secAgo(0) }, NOW);
    expect(s.kind).toBe("waterChange");
    expect(s.urgent).toBe(true);
  });

  it("suggests a test when none for 7+ days", () => {
    const s = pickSuggestion({ tankType: 0, latestLog: healthyLog, latestTestTimestamp: secAgo(9), latestChangeTimestamp: secAgo(1) }, NOW);
    expect(s.kind).toBe("test");
  });

  it("suggests a test when never tested", () => {
    const s = pickSuggestion({ tankType: 0, latestChangeTimestamp: secAgo(1) }, NOW);
    expect(s.kind).toBe("test");
    expect(s.title).toMatch(/test your water/i);
  });

  it("suggests a water change when tested recently but not changed in 7+ days", () => {
    const s = pickSuggestion({ tankType: 0, latestLog: healthyLog, latestTestTimestamp: secAgo(1), latestChangeTimestamp: secAgo(9) }, NOW);
    expect(s.kind).toBe("waterChange");
    expect(s.urgent).toBeUndefined();
  });

  it("praises when everything is on track", () => {
    const s = pickSuggestion({ tankType: 0, latestLog: healthyLog, latestTestTimestamp: secAgo(1), latestChangeTimestamp: secAgo(2) }, NOW);
    expect(s.kind).toBeNull();
    expect(s.title).toMatch(/great fishkeeper/i);
  });
});

describe("CareCoach — schedule-driven suggestions", () => {
  const nowSec = NOW / 1000;
  const healthyTank = { tankType: 0, latestLog: healthyLog };

  it("suggests the due test (never done) over a not-yet-due change", () => {
    const schedules = [
      { kind: "test", lastDoneAt: null, nextDueAt: nowSec, enabled: true },
      { kind: "waterChange", lastDoneAt: secAgo(1), nextDueAt: nowSec + 6 * 86400, enabled: true },
    ];
    const s = pickSuggestion(healthyTank, NOW, schedules);
    expect(s.kind).toBe("test");
    expect(s.title).toMatch(/test your water/i);
  });

  it("suggests the overdue change with a day count", () => {
    const schedules = [
      { kind: "test", lastDoneAt: secAgo(1), nextDueAt: nowSec + 6 * 86400, enabled: true },
      { kind: "waterChange", lastDoneAt: secAgo(10), nextDueAt: nowSec - 3 * 86400, enabled: true },
    ];
    const s = pickSuggestion(healthyTank, NOW, schedules);
    expect(s.kind).toBe("waterChange");
    expect(s.title).toMatch(/overdue by 3d/i);
  });

  it("praises when no schedule is due", () => {
    const schedules = [
      { kind: "test", lastDoneAt: secAgo(1), nextDueAt: nowSec + 6 * 86400, enabled: true },
      { kind: "waterChange", lastDoneAt: secAgo(1), nextDueAt: nowSec + 6 * 86400, enabled: true },
    ];
    const s = pickSuggestion(healthyTank, NOW, schedules);
    expect(s.kind).toBeNull();
  });

  it("emergency overrides schedules", () => {
    const schedules = [{ kind: "test", lastDoneAt: secAgo(1), nextDueAt: nowSec + 6 * 86400, enabled: true }];
    const s = pickSuggestion({ tankType: 0, latestLog: ammoniaLog }, NOW, schedules);
    expect(s.urgent).toBe(true);
  });
});
