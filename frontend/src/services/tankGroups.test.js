import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "../db";
import {
  ALL_GROUPS,
  UNASSIGNED,
  assignTankToGroup,
  countUnassigned,
  createGroup,
  deleteGroup,
  filterTanksByGroup,
  mergeGroups,
  normalizeGroupName,
  renameGroup,
  tankGroupName,
  tankInGroup,
  loadCustomGroups,
} from "./tankGroups";

const OWNER = "0xABCDEF";

const mkTank = (id, facility, extra = {}) => ({
  id,
  ownerAddress: OWNER.toLowerCase(),
  name: `Tank ${id}`,
  active: true,
  parentUnitId: 0,
  facility,
  room: "Aisle 1",
  rack: "Tier 2",
  specimens: [],
  ...extra,
});

describe("tankGroups", () => {
  beforeEach(async () => {
    if (!db.isOpen()) await db.open();
    await db.tankGroups.clear();
    await db.tanks.clear();
  });

  it("normalizes names and derives membership from facility only", () => {
    expect(normalizeGroupName("  Fish   Room ")).toBe("Fish Room");
    expect(normalizeGroupName("x".repeat(80)).length).toBe(40);

    const t = mkTank(1, "Fish Room");
    expect(tankGroupName(t)).toBe("Fish Room");
    // room/rack must NOT satisfy a group chip anymore
    expect(tankInGroup(t, "Aisle 1")).toBe(false);
    expect(tankInGroup(t, "Tier 2")).toBe(false);
    expect(tankInGroup(t, "fish room")).toBe(true);
    expect(tankInGroup(t, ALL_GROUPS)).toBe(true);
    expect(tankInGroup(mkTank(2, ""), UNASSIGNED)).toBe(true);
    expect(tankInGroup(t, UNASSIGNED)).toBe(false);
  });

  it("counts each tank exactly once per group", () => {
    const tanks = [mkTank(1, "Fish Room"), mkTank(2, "Fish Room"), mkTank(3, ""), mkTank(4, "Garage")];
    expect(filterTanksByGroup(tanks, "Fish Room").length).toBe(2);
    expect(filterTanksByGroup(tanks, ALL_GROUPS).length).toBe(4);
    expect(countUnassigned(tanks)).toBe(1);
  });

  it("merges custom groups first, then names discovered on tanks, deduped", () => {
    const custom = [{ name: "Greenhouse", sortOrder: 1 }, { name: "Fish Room", sortOrder: 2 }];
    const tanks = [mkTank(1, "fish room"), mkTank(2, "Basement"), mkTank(3, "")];
    expect(mergeGroups(custom, tanks)).toEqual(["Greenhouse", "Fish Room", "Basement"]);
  });

  it("creates groups, rejecting blanks, reserved and duplicate names", async () => {
    const name = await createGroup(OWNER, "  Fish Room  ", []);
    expect(name).toBe("Fish Room");
    const rows = await loadCustomGroups(OWNER);
    expect(rows.map((r) => r.name)).toEqual(["Fish Room"]);

    await expect(createGroup(OWNER, "   ", [])).rejects.toThrow();
    await expect(createGroup(OWNER, "All", [])).rejects.toThrow();
    await expect(createGroup(OWNER, "fish room", ["Fish Room"])).rejects.toThrow();
  });

  it("assigns a tank into a group and un-assigns it", async () => {
    const t = mkTank(7, "");
    await db.tanks.put(t);
    await assignTankToGroup(t, "Fish Room");
    expect((await db.tanks.get(7)).facility).toBe("Fish Room");
    await assignTankToGroup(t, UNASSIGNED);
    expect((await db.tanks.get(7)).facility).toBe("");
  });

  it("assigns a chain-only tank by writing it through to Dexie", async () => {
    const t = mkTank(99, "");
    expect(await db.tanks.get(99)).toBeUndefined();
    await assignTankToGroup(t, "Greenhouse");
    expect((await db.tanks.get(99)).facility).toBe("Greenhouse");
  });

  it("renames a group and re-points its member tanks", async () => {
    const tanks = [mkTank(1, "Main Room"), mkTank(2, "Main Room"), mkTank(3, "Garage")];
    await db.tanks.bulkPut(tanks);
    await createGroup(OWNER, "Main Room", []);

    const moved = await renameGroup(OWNER, "Main Room", "Fish Room", tanks, ["Main Room", "Garage"]);
    expect(moved).toBe(2);
    expect((await db.tanks.get(1)).facility).toBe("Fish Room");
    expect((await db.tanks.get(2)).facility).toBe("Fish Room");
    expect((await db.tanks.get(3)).facility).toBe("Garage");
    expect((await loadCustomGroups(OWNER)).map((r) => r.name)).toEqual(["Fish Room"]);

    await expect(renameGroup(OWNER, "Garage", "Fish Room", tanks, ["Fish Room", "Garage"])).rejects.toThrow();
  });

  it("renames a derived group that was never explicitly created", async () => {
    const tanks = [mkTank(1, "Outdoor Ponds")];
    await db.tanks.bulkPut(tanks);
    const moved = await renameGroup(OWNER, "Outdoor Ponds", "Back Yard", tanks, ["Outdoor Ponds"]);
    expect(moved).toBe(1);
    expect((await db.tanks.get(1)).facility).toBe("Back Yard");
    expect((await loadCustomGroups(OWNER)).map((r) => r.name)).toEqual(["Back Yard"]);
  });

  it("deleting a group un-assigns tanks instead of deleting them", async () => {
    const tanks = [mkTank(1, "Garage"), mkTank(2, "Garage")];
    await db.tanks.bulkPut(tanks);
    await createGroup(OWNER, "Garage", []);

    const freed = await deleteGroup(OWNER, "Garage", tanks);
    expect(freed).toBe(2);
    expect(await db.tanks.count()).toBe(2);
    expect((await db.tanks.get(1)).facility).toBe("");
    expect((await db.tanks.get(2)).active).toBe(true);
    expect(await loadCustomGroups(OWNER)).toEqual([]);
  });
});
