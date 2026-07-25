import { describe, it, expect } from "vitest";
import { rankRows } from "./ProOpsGrid";

const row = (name, status, overdue = 0, testTs = 0, stock = 0) => ({
  tank: { name, latestTestTimestamp: testTs, latestChangeTimestamp: testTs },
  health: { status, overdue: new Array(overdue).fill({}) },
  stock,
});

const sortWith = (rows, key) => [...rows].sort((a, b) => rankRows(a, b, key));

describe("ProOpsGrid — rankRows", () => {
  it("attention sort puts alert before drifting before ok", () => {
    const rows = [row("A", "ok"), row("B", "alert"), row("C", "drifting")];
    const sorted = sortWith(rows, "attention").map((r) => r.tank.name);
    expect(sorted).toEqual(["B", "C", "A"]);
  });

  it("attention tiebreak: more overdue first, then oldest test", () => {
    const rows = [
      row("few", "drifting", 1, 500),
      row("many", "drifting", 3, 900),
      row("oldtest", "drifting", 1, 100),
    ];
    const sorted = sortWith(rows, "attention").map((r) => r.tank.name);
    expect(sorted[0]).toBe("many"); // most overdue
    expect(sorted[1]).toBe("oldtest"); // same overdue as 'few' but older test
    expect(sorted[2]).toBe("few");
  });

  it("name sort is alphabetical", () => {
    const rows = [row("Zeta", "ok"), row("Alpha", "ok")];
    expect(sortWith(rows, "name").map((r) => r.tank.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("stock sort is descending", () => {
    const rows = [row("a", "ok", 0, 0, 2), row("b", "ok", 0, 0, 9)];
    expect(sortWith(rows, "stock").map((r) => r.tank.name)).toEqual(["b", "a"]);
  });

  it("oldest-test sort ascends by timestamp", () => {
    const rows = [row("new", "ok", 0, 900), row("old", "ok", 0, 100)];
    expect(sortWith(rows, "test").map((r) => r.tank.name)).toEqual(["old", "new"]);
  });
});
