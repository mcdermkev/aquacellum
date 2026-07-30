/**
 * Ownership scoping for the birth-certificate registration path.
 *
 * `loadOwnedSpecimens` feeds the Sire/Dam pickers on the Register form, so
 * anything it returns can be written onto a new birth certificate as a parent.
 * It used to carry a "beta single-device fallback" that returned EVERY specimen
 * in IndexedDB when nothing matched the signed-in account — so on a shared
 * browser profile, or after an account switch, one account could claim another
 * account's fish as parents. These tests pin the hard filter.
 *
 * The MintSpecimen tank dropdown had the identical fallback (the selected tank is
 * written onto the certificate as its containment unit); that one is asserted as
 * a source guard, since the component needs a browser environment this project's
 * node-environment vitest doesn't provide.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

const specimenRows = [];

vi.mock("../db", () => ({
  db: {
    specimens: {
      toArray: async () => specimenRows,
    },
  },
}));

const { loadOwnedSpecimens, specimenOptionLabel } = await import("../utils/ownedSpecimens");

const ACCOUNT_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ACCOUNT_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function specimen(overrides) {
  return {
    id: 1,
    speciesId: 10,
    commonName: "Convict Cichlid",
    scientificName: "Amatitlania nigrofasciata",
    status: 0,
    ownerAddress: ACCOUNT_A,
    sireId: 0,
    damId: 0,
    ...overrides,
  };
}

function setRows(rows) {
  specimenRows.length = 0;
  specimenRows.push(...rows);
}

beforeEach(() => setRows([]));

describe("loadOwnedSpecimens — ownership is a hard filter", () => {
  it("returns only the signed-in account's specimens", async () => {
    setRows([
      specimen({ id: 1, ownerAddress: ACCOUNT_A }),
      specimen({ id: 2, ownerAddress: ACCOUNT_B }),
    ]);
    const rows = await loadOwnedSpecimens(ACCOUNT_A);
    expect(rows.map((r) => r.id)).toEqual([1]);
  });

  it("returns empty rather than another account's fish when the user owns none", async () => {
    setRows([
      specimen({ id: 1, ownerAddress: ACCOUNT_A }),
      specimen({ id: 2, ownerAddress: ACCOUNT_A }),
    ]);
    // Account B has just signed in on the same browser profile.
    expect(await loadOwnedSpecimens(ACCOUNT_B)).toEqual([]);
  });

  it("returns empty when there is no signed-in account", async () => {
    setRows([specimen({ id: 1 })]);
    expect(await loadOwnedSpecimens("")).toEqual([]);
    expect(await loadOwnedSpecimens(null)).toEqual([]);
    expect(await loadOwnedSpecimens(undefined)).toEqual([]);
  });

  it("matches the account case-insensitively (stored rows are lowercase EOAs)", async () => {
    setRows([specimen({ id: 4, ownerAddress: ACCOUNT_A })]);
    const rows = await loadOwnedSpecimens(ACCOUNT_A.toUpperCase());
    expect(rows.map((r) => r.id)).toEqual([4]);
  });

  it("still includes pre-owner-field legacy records", async () => {
    setRows([
      specimen({ id: 5, ownerAddress: "" }),
      specimen({ id: 6, ownerAddress: undefined }),
      specimen({ id: 7, ownerAddress: ACCOUNT_B }),
    ]);
    const rows = await loadOwnedSpecimens(ACCOUNT_A);
    expect(rows.map((r) => r.id)).toEqual([5, 6]);
  });

  it("excludes non-active specimens so a dead or rehomed fish can't be a parent", async () => {
    setRows([
      specimen({ id: 8, status: 0 }),
      specimen({ id: 9, status: 1 }), // Deceased
      specimen({ id: 10, status: 2 }), // Rehomed
    ]);
    const rows = await loadOwnedSpecimens(ACCOUNT_A);
    expect(rows.map((r) => r.id)).toEqual([8]);
  });

  it("sorts by serial ascending", async () => {
    setRows([
      specimen({ id: 30 }),
      specimen({ id: 4 }),
      specimen({ id: 12 }),
    ]);
    const rows = await loadOwnedSpecimens(ACCOUNT_A);
    expect(rows.map((r) => r.id)).toEqual([4, 12, 30]);
  });

  it("labels options with a padded, untruncated serial", () => {
    expect(specimenOptionLabel({ id: 7, commonName: "Neon Tetra", breederStockTag: "" }))
      .toBe("Cert. 007 — Neon Tetra");
    expect(specimenOptionLabel({ id: 1042, commonName: "Neon Tetra", breederStockTag: "esgIV" }))
      .toBe("Cert. 1042 — Neon Tetra [esgIV]");
  });
});

describe("MintSpecimen — registration form source guards", () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL("../components/MintSpecimen.jsx", import.meta.url)),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("does not fall back to listing every tank on the device", () => {
    expect(SOURCE).not.toContain("allLocalTanks.filter(t => t.active !== false)");
    expect(SOURCE).toContain("acct ? await db.tanks.toArray() : []");
  });

  it("attributes the certificate to the signed-in account, not a form field", () => {
    expect(SOURCE).toContain("breeder: walletAccount");
    // \b excludes the unrelated formData.breederStockTag field.
    expect(SOURCE).not.toMatch(/formData\.breeder\b/);
    expect(SOURCE).not.toContain("breederEditable");
  });

  it("no longer ships the permission trap", () => {
    expect(SOURCE).not.toContain("you do not have permission");
  });
});
