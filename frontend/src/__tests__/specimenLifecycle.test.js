/**
 * Specimen lifecycle — retire vs archive (docs/BREEDER_STATE_MODEL.md §4.1).
 *
 * THE INVARIANT: a birth certificate is never destroyed. This is a lineage
 * tracker; a certificate is referenced by `sireId`/`damId` on every descendant,
 * by listings, by orders, and by exported pedigrees. Deleting one doesn't remove
 * a fish from the world, it orphans everything downstream.
 *
 * So "remove it from my tank" must ARCHIVE (reversible, no outcome claimed, still
 * resolvable in lineage) and never delete. `TankList` previously called
 * `db.specimens.delete` here, which was destructive AND ineffective — the cloud
 * pull re-inserted the row on next login.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

let specimenRows = [];
let tankRows = [];
const deleteCalls = [];
const cloudSyncs = { specimens: [], tanks: [] };

vi.mock("../db", () => ({
  db: {
    specimens: {
      get: async (id) => specimenRows.find((s) => Number(s.id) === Number(id)),
      update: async (id, patch) => {
        const row = specimenRows.find((s) => Number(s.id) === Number(id));
        if (row) Object.assign(row, patch);
        return row ? 1 : 0;
      },
      // Present so an accidental delete would succeed loudly rather than throw —
      // the assertion below is that nothing ever calls it.
      delete: async (id) => {
        deleteCalls.push(Number(id));
      },
    },
    tanks: {
      get: async (id) => tankRows.find((t) => Number(t.id) === Number(id)),
      update: async (id, patch) => {
        const row = tankRows.find((t) => Number(t.id) === Number(id));
        if (row) Object.assign(row, patch);
        return row ? 1 : 0;
      },
    },
  },
}));

vi.mock("../services/cloudSync", () => ({
  syncSpecimenToCloud: async (s) => { cloudSyncs.specimens.push(s.id); },
  syncTankToCloud: async (t) => { cloudSyncs.tanks.push(t.id); },
}));

const {
  retireSpecimens,
  archiveSpecimens,
  unarchiveSpecimens,
  isArchived,
} = await import("../services/specimenLifecycle");
const { SPECIMEN_STATUS } = await import("../utils/specimenIdentity");

beforeEach(() => {
  specimenRows = [
    { id: 1, status: 0, currentTankId: 100, commonName: "Convict Cichlid" },
    { id: 2, status: 0, currentTankId: 100, commonName: "Convict Cichlid" },
    { id: 3, status: 0, currentTankId: 0, commonName: "Orphan Fry" },
  ];
  tankRows = [{ id: 100, specimens: [{ id: 1 }, { id: 2 }] }];
  deleteCalls.length = 0;
  cloudSyncs.specimens.length = 0;
  cloudSyncs.tanks.length = 0;
});

describe("the never-destroy invariant", () => {
  it("exposes no delete/remove/purge function at all", async () => {
    const mod = await import("../services/specimenLifecycle");
    for (const name of Object.keys(mod)) {
      expect(name.toLowerCase()).not.toContain("delete");
      expect(name.toLowerCase()).not.toContain("purge");
      expect(name.toLowerCase()).not.toContain("destroy");
    }
  });

  it("never calls db.specimens.delete, for any lifecycle action", async () => {
    await retireSpecimens([1], SPECIMEN_STATUS.REHOMED);
    await retireSpecimens([2], SPECIMEN_STATUS.DECEASED);
    await archiveSpecimens([3]);
    await unarchiveSpecimens([3]);
    expect(deleteCalls).toEqual([]);
    // All three records still exist.
    expect(specimenRows).toHaveLength(3);
  });

  it("has no delete call left in the source of either lifecycle surface", () => {
    for (const path of ["../components/TankList.jsx", "../components/FryNursery.jsx"]) {
      const src = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(src).not.toContain("db.specimens.delete");
    }
  });
});

describe("retireSpecimens", () => {
  it("records the outcome and detaches from the tank", async () => {
    await retireSpecimens([1], SPECIMEN_STATUS.REHOMED);
    const spec = specimenRows.find((s) => s.id === 1);
    expect(spec.status).toBe(SPECIMEN_STATUS.REHOMED);
    expect(spec.currentTankId).toBe(0);
    expect(tankRows[0].specimens.map((s) => s.id)).toEqual([2]);
  });

  it("mirrors both the specimen and the tank to the cloud", async () => {
    await retireSpecimens([1], SPECIMEN_STATUS.DECEASED);
    expect(cloudSyncs.specimens).toContain(1);
    expect(cloudSyncs.tanks).toContain(100);
  });

  it("refuses a status that is not a retirement", async () => {
    const res = await retireSpecimens([1], SPECIMEN_STATUS.ACTIVE);
    expect(res.ok).toBe(false);
    expect(specimenRows.find((s) => s.id === 1).status).toBe(0);
  });

  it("refuses out-of-range and garbage statuses", async () => {
    for (const bad of [3, -1, 99, null, undefined, "1"]) {
      const res = await retireSpecimens([1], bad);
      expect(res.ok).toBe(false);
    }
    expect(specimenRows.find((s) => s.id === 1).status).toBe(0);
  });

  it("handles a specimen that isn't in any tank", async () => {
    const res = await retireSpecimens([3], SPECIMEN_STATUS.DECEASED);
    expect(res.ok).toBe(true);
    expect(specimenRows.find((s) => s.id === 3).status).toBe(SPECIMEN_STATUS.DECEASED);
  });

  it("accepts a bare id as well as an array", async () => {
    await retireSpecimens(1, SPECIMEN_STATUS.REHOMED);
    expect(specimenRows.find((s) => s.id === 1).status).toBe(SPECIMEN_STATUS.REHOMED);
  });

  it("retires a whole group", async () => {
    const res = await retireSpecimens([1, 2], SPECIMEN_STATUS.REHOMED);
    expect(res.updated).toEqual([1, 2]);
    expect(tankRows[0].specimens).toEqual([]);
  });
});

describe("archiveSpecimens", () => {
  it("hides the certificate WITHOUT claiming an outcome", async () => {
    await archiveSpecimens([1]);
    const spec = specimenRows.find((s) => s.id === 1);
    expect(spec.archived).toBe(true);
    expect(spec.archivedAt).toBeTypeOf("number");
    // The crucial part: status is untouched. Archiving is not a death or a sale.
    expect(spec.status).toBe(SPECIMEN_STATUS.ACTIVE);
  });

  it("detaches from the tank so it leaves the tank view", async () => {
    await archiveSpecimens([1]);
    expect(specimenRows.find((s) => s.id === 1).currentTankId).toBe(0);
    expect(tankRows[0].specimens.map((s) => s.id)).toEqual([2]);
  });

  it("is reversible — otherwise it's a delete with extra steps", async () => {
    await archiveSpecimens([1]);
    expect(isArchived(specimenRows.find((s) => s.id === 1))).toBe(true);
    await unarchiveSpecimens([1]);
    const spec = specimenRows.find((s) => s.id === 1);
    expect(isArchived(spec)).toBe(false);
    expect(spec.status).toBe(SPECIMEN_STATUS.ACTIVE);
  });

  it("mirrors to the cloud so the fish doesn't reappear on another device", async () => {
    await archiveSpecimens([1]);
    expect(cloudSyncs.specimens).toContain(1);
  });

  it("isArchived tolerates missing records and the un-set field", () => {
    expect(isArchived(null)).toBe(false);
    expect(isArchived(undefined)).toBe(false);
    expect(isArchived({ id: 9 })).toBe(false);
    expect(isArchived({ id: 9, archived: true })).toBe(true);
  });
});

describe("archived certificates stay out of pickers but not out of lineage", () => {
  function source(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("the sire/dam picker excludes archived", () => {
    expect(source("../utils/ownedSpecimens.js")).toContain("if (s.archived) return false");
  });

  it("the nursery tray excludes archived", () => {
    expect(source("../components/FryNursery.jsx")).toContain("isArchived(s)");
  });

  it("the spawning wizard's parent list excludes archived", () => {
    expect(source("../components/SpawningWizard.jsx")).toContain("if (spec.archived) continue");
  });

  it("the pedigree resolver does NOT filter on archived — descendants must still resolve", () => {
    expect(source("../services/pedigree.js")).not.toContain("archived");
  });
});
