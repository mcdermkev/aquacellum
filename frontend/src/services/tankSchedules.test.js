import { describe, it, expect } from "vitest";
import { computeNextDue, isScheduleDue, actionTypeToScheduleKind } from "./tankSchedules";

describe("tankSchedules — pure helpers", () => {
  it("computeNextDue adds cadence days in seconds", () => {
    expect(computeNextDue(1000, 7)).toBe(1000 + 7 * 86400);
    expect(computeNextDue(0, 1)).toBe(86400);
  });

  it("isScheduleDue: never-done is always due", () => {
    expect(isScheduleDue({ lastDoneAt: null, nextDueAt: 9_999_999_999, enabled: true }, 1000)).toBe(true);
  });

  it("isScheduleDue: past next-due is due, future is not", () => {
    const now = 1_000_000;
    expect(isScheduleDue({ lastDoneAt: 1, nextDueAt: now - 10, enabled: true }, now)).toBe(true);
    expect(isScheduleDue({ lastDoneAt: 1, nextDueAt: now + 10, enabled: true }, now)).toBe(false);
  });

  it("isScheduleDue: disabled is never due", () => {
    expect(isScheduleDue({ lastDoneAt: null, nextDueAt: 0, enabled: false }, 1000)).toBe(false);
  });

  it("actionTypeToScheduleKind maps care types", () => {
    expect(actionTypeToScheduleKind("Water Change")).toBe("waterChange");
    expect(actionTypeToScheduleKind("Log Immediate Water Change")).toBe("waterChange");
    expect(actionTypeToScheduleKind("Quick Water Test")).toBe("test");
    expect(actionTypeToScheduleKind("Detailed Test")).toBe("test");
    expect(actionTypeToScheduleKind("Feed")).toBeNull();
  });
});
