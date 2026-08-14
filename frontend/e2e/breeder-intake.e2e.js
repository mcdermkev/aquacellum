// e2e/breeder-intake.e2e.js — the breeder onboarding intake flows.
//
// Covers what unit tests cannot: that the Pro surfaces actually render, the
// controls are reachable, and a real click-through lands the right rows in Dexie.
// Specs: docs/BULK_TANK_CREATE_SPEC.md, CSV_TANK_IMPORT_SPEC.md,
// LIVESTOCK_IMPORT_SPEC.md, LINEAGE_FIRST_INTAKE_SPEC.md, GROWOUT_TANK_SPEC.md.
import { test, expect } from "@playwright/test";
import {
  gotoDashboard,
  seed,
  reloadDashboard,
  readTable,
  openFacilityTree,
  readOwnedTanks,
  seedSpeciesCatalog,
  seedSpawn,
  E2E_STUB_ACCOUNT,
  DESKTOP_ONLY_REASON,
} from "./helpers.js";

/** Land in Pro mode on the facility tree with one pre-existing tank. */
async function proFacilityTree(page) {
  await gotoDashboard(page, { casual: false });
  await seed(page, { tanks: [{ name: "Existing Tank", volumeLiters: 75 }] });
  await reloadDashboard(page);
  await openFacilityTree(page);
}

test.describe("Rack stamping (bulk tank create)", () => {
  test("I1. stamps a rack of identical units with distinct ids", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", DESKTOP_ONLY_REASON);
    await proFacilityTree(page);

    const before = await readOwnedTanks(page);

    await page.getByRole("button", { name: /Add a Rack/i }).click();
    await expect(page.getByRole("heading", { name: /Add a Rack/i })).toBeVisible();

    await page.locator("#bulk-count").fill("10");
    await page.locator("#bulk-prefix").fill("Grow-out");
    await page.locator("#bulk-room").fill("Room A");
    await page.locator("#bulk-rack").fill("Rack 2");

    // The live preview must show the pattern before anything is written.
    await expect(page.getByText(/Grow-out 1, Grow-out 2, Grow-out 3/)).toBeVisible();

    // 10 is under CONFIRM_THRESHOLD (12), so this is a single click.
    await page.getByRole("button", { name: /^Create 10 units$/ }).click();

    await expect(page.getByText(/Created 10 units/i)).toBeVisible({ timeout: 15_000 });

    const after = await readOwnedTanks(page);
    expect(after.length - before.length).toBe(10);

    const created = after.slice(0, 10);
    // The regression this whole service exists for: Date.now() ids would collide.
    expect(new Set(created.map((t) => t.id)).size).toBe(10);
    for (const t of created) {
      expect(t.room).toBe("Room A");
      expect(t.rack).toBe("Rack 2");
      expect(t.parentUnitId).toBe(0);
      expect(t.active).toBe(true);
    }
    expect(created.map((t) => t.name).sort()).toEqual(
      ["Grow-out 1", "Grow-out 10", "Grow-out 2", "Grow-out 3", "Grow-out 4",
       "Grow-out 5", "Grow-out 6", "Grow-out 7", "Grow-out 8", "Grow-out 9"]
    );
  });

  test("I2. requires a second confirm click above the threshold", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", DESKTOP_ONLY_REASON);
    await proFacilityTree(page);
    const before = await readOwnedTanks(page);

    await page.getByRole("button", { name: /Add a Rack/i }).click();
    await page.locator("#bulk-count").fill("20");

    // First click only arms the confirm — nothing is written yet.
    await page.getByRole("button", { name: /^Create 20 units$/ }).click();
    await expect(page.getByText(/Click again to confirm/i)).toBeVisible();
    expect((await readOwnedTanks(page)).length).toBe(before.length);

    await page.getByRole("button", { name: /Confirm — create 20/ }).click();
    await expect(page.getByText(/Created 20 units/i)).toBeVisible({ timeout: 15_000 });
    expect((await readOwnedTanks(page)).length - before.length).toBe(20);
  });
});

test.describe("Tank CSV import", () => {
  test("I3. imports valid rows, skips a nameless one, and warns on saltwater", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", DESKTOP_ONLY_REASON);
    await proFacilityTree(page);
    const before = await readOwnedTanks(page);

    await page.getByRole("button", { name: /Import Tanks/i }).click();
    await expect(page.getByRole("heading", { name: /Import tanks/i })).toBeVisible();

    // Row 3 has no name (must be skipped); row 2 is saltwater (imports + warns).
    await page.locator("#import-tanks-paste").fill(
      [
        "Name,Volume,Water,Group,Room,Rack",
        "Betta A1,5,Freshwater,Fish Room,Room A,Rack 1",
        "Reef Thing,20,Saltwater,Fish Room,Room A,Rack 1",
        ",10,Freshwater,Fish Room,Room A,Rack 1",
      ].join("\n")
    );

    // 2 of the 3 data rows are importable.
    await expect(page.getByText(/2 ready/)).toBeVisible();
    await expect(page.getByText(/1 skipped/)).toBeVisible();
    await expect(page.getByText(/Missing tank name/i)).toBeVisible();
    await expect(page.getByText(/Saltwater isn't supported/i)).toBeVisible();

    await page.getByRole("button", { name: /^Import 2 tanks$/ }).click();
    await expect(page.getByText(/Imported 2 tanks/i)).toBeVisible({ timeout: 15_000 });

    const after = await readOwnedTanks(page);
    expect(after.length - before.length).toBe(2);
    const names = after.slice(0, 2).map((t) => t.name).sort();
    expect(names).toEqual(["Betta A1", "Reef Thing"]);

    // Saltwater never lands as a saltwater tank — it is mapped to Freshwater (0).
    const reef = after.find((t) => t.name === "Reef Thing");
    expect(reef.tankType).toBe(0);
    // 5 gal -> liters, so the gallons->liters conversion actually ran.
    const betta = after.find((t) => t.name === "Betta A1");
    expect(betta.volumeLiters).toBe(Math.round(5 * 3.78541));
  });
});

test.describe("Livestock CSV import", () => {
  test("I4. blocks a fuzzy species until it is picked, then registers the fish", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", DESKTOP_ONLY_REASON);
    await gotoDashboard(page, { casual: false });
    await seed(page, { tanks: [{ name: "Grow-out 1", volumeLiters: 38 }] });
    await seedSpeciesCatalog(page);
    await reloadDashboard(page);
    await openFacilityTree(page);

    const specimensBefore = (await readTable(page, "specimens")).length;

    await page.getByRole("button", { name: /Import Livestock/i }).click();
    await expect(page.getByRole("heading", { name: /Import livestock/i })).toBeVisible();

    // "Guppy" is an exact catalog match; "Guppyy" is a typo that must NOT
    // auto-resolve — that is the whole safety rule of the species matcher.
    await page.locator("#import-livestock-paste").fill(
      [
        "Species,Quantity,Sex,Tank",
        "Guppy,3,Mixed,Grow-out 1",
        "Guppyy,2,Male,Grow-out 1",
      ].join("\n")
    );

    // Only the exact row is ready; the typo row is skipped until resolved.
    await expect(page.getByText(/3 fish ready/)).toBeVisible();
    await expect(page.getByText(/need a match/i)).toBeVisible();

    // Resolve the typo by picking from the catalog dropdown. Selected by value
    // (the speciesId) rather than label — the option text carries the scientific
    // name too, and selectOption does not take a regex.
    // Target the TYPO row specifically — every distinct name gets its own picker,
    // and the exact-match row already has one.
    await page.getByLabel('Species for "Guppyy"').selectOption("1");

    await expect(page.getByText(/5 fish ready/)).toBeVisible();

    await page.getByRole("button", { name: /^Import 5 fish$/ }).click();
    await expect(page.getByText(/Imported 5 fish/i)).toBeVisible({ timeout: 20_000 });

    const specimens = await readTable(page, "specimens");
    expect(specimens.length - specimensBefore).toBe(5);

    const mine = specimens.filter((s) => String(s.ownerAddress).toLowerCase() === E2E_STUB_ACCOUNT);
    // Sequential serials, all distinct — the collision guard.
    expect(new Set(mine.map((s) => s.id)).size).toBe(mine.length);
    for (const s of mine) {
      expect(s.speciesId).toBe(1);
      expect(s.status).toBe(0);
      // Imported fish are never given fabricated parents.
      expect(s.sireId).toBe(0);
      expect(s.damId).toBe(0);
    }
    // "Mixed" must normalize to Unsexed, never an invented sex.
    expect(mine.filter((s) => s.gender === "Unsexed").length).toBe(3);
    expect(mine.filter((s) => s.gender === "Male").length).toBe(2);

    // The fish must also be embedded on the tank — that is what the species
    // count and the inhabitants list read.
    const tanks = await readOwnedTanks(page);
    const growout = tanks.find((t) => t.name === "Grow-out 1");
    expect(growout.specimens.length).toBe(5);
  });
});

test.describe("Lineage-first intake (breeding program)", () => {
  test("I5. declaring lines creates a tank per line and foundation stock per fish", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", DESKTOP_ONLY_REASON);
    await gotoDashboard(page, { casual: false });
    await seedSpeciesCatalog(page);

    // Deep-linked Breeder Tools section (App.jsx passes ?section= straight through).
    await page.goto("/app/breeder?section=program&e2e=1");
    await page.getByRole("button", { name: /Declare your breeding program/i }).click();
    await expect(page.getByRole("heading", { name: /Declare your breeding program/i })).toBeVisible();

    // Line 1: exact species match, 2 males + 3 females.
    await page.getByLabel("Line name, row 1").fill("Blue Grass A1");
    await page.getByLabel("Species, row 1").fill("Guppy");
    // `exact` matters: "Females, row 1" contains "males, row 1".
    await page.getByLabel("Males, row 1", { exact: true }).fill("2");
    await page.getByLabel("Females, row 1", { exact: true }).fill("3");

    // Line 2: a typo, which must NOT auto-resolve.
    await page.getByRole("button", { name: /Add line/i }).click();
    await page.getByLabel("Line name, row 2").fill("Betta B2");
    await page.getByLabel("Species, row 2").fill("Bettaa");
    await page.getByLabel("Males, row 2", { exact: true }).fill("1");
    await page.getByLabel("Females, row 2", { exact: true }).fill("1");

    // Only line 1 counts until the typo is resolved.
    await expect(page.getByText(/1 lines · 1 tanks · 5 fish/)).toBeVisible();
    await expect(page.getByText(/1 incomplete/)).toBeVisible();

    await page.getByLabel("Pick species, row 2").selectOption("3");
    await expect(page.getByText(/2 lines · 2 tanks · 7 fish/)).toBeVisible();

    // The foundation-stock note must be on screen before anything is written.
    await expect(page.getByText(/no parents/i)).toBeVisible();

    await page.getByRole("button", { name: /Create 2 tanks & 7 fish/ }).click();
    await expect(page.getByText(/Created 2 tanks and 7 birth certificates/i)).toBeVisible({ timeout: 20_000 });

    const tanks = await readOwnedTanks(page);
    const a1 = tanks.find((t) => t.name === "Blue Grass A1");
    const b2 = tanks.find((t) => t.name === "Betta B2");
    expect(a1).toBeTruthy();
    expect(b2).toBeTruthy();

    const specimens = (await readTable(page, "specimens"))
      .filter((s) => String(s.ownerAddress).toLowerCase() === E2E_STUB_ACCOUNT);
    expect(specimens.length).toBe(7);

    const line1 = specimens.filter((s) => s.breederStockTag === "Blue Grass A1");
    expect(line1.length).toBe(5);
    expect(line1.filter((s) => s.gender === "Male").length).toBe(2);
    expect(line1.filter((s) => s.gender === "Female").length).toBe(3);
    // Every fish sits in its own line's tank, tagged with the line name.
    expect(line1.every((s) => s.currentTankId === a1.id)).toBe(true);
    expect(line1.every((s) => s.speciesId === 1)).toBe(true);

    const line2 = specimens.filter((s) => s.breederStockTag === "Betta B2");
    expect(line2.length).toBe(2);
    expect(line2.every((s) => s.currentTankId === b2.id)).toBe(true);
    expect(line2.every((s) => s.speciesId === 3)).toBe(true);

    // THE rule: declared stock is foundation stock. A fabricated ancestor here
    // would make every pairing of these fish report a false "verified 0%" COI.
    for (const s of specimens) {
      expect(s.sireId).toBe(0);
      expect(s.damId).toBe(0);
      expect(s.status).toBe(0);
    }

    // And the fish are embedded on their tanks, so counts/inhabitants see them.
    expect(a1.specimens.length).toBe(5);
    expect(b2.specimens.length).toBe(2);
  });
});

test.describe("Grow-out tank from a spawn", () => {
  const SPAWN_ID = 1700000000000;

  test("I6. creates the tank, records the headcount, and does NOT shrink the cohort", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", DESKTOP_ONLY_REASON);
    await gotoDashboard(page, { casual: false });
    await seed(page, { tanks: [{ id: 5000, name: "Spawn Tank", volumeLiters: 75 }] });
    await seedSpawn(page, { spawnId: SPAWN_ID, tankId: 5000, speciesId: 1 });

    await page.goto("/app/breeder?section=growout&e2e=1");

    // The per-spawn tracker is collapsed by default.
    await page.getByRole("button", { name: /Track Grow-Out/i }).first().click();
    await page.getByRole("button", { name: /^Set up$/ }).first().click();
    await page.getByLabel(/Tank name/i).fill("Fry Rack 1");
    await page.getByLabel(/Fry in this batch/i).fill("120");
    await page.getByRole("button", { name: /Create grow-out tank/i }).click();

    await expect(page.getByText(/Fry Rack 1 created/i)).toBeVisible({ timeout: 20_000 });

    // The tank exists and the cohort now points at it.
    const tanks = await readOwnedTanks(page);
    const fryRack = tanks.find((t) => t.name === "Fry Rack 1");
    expect(fryRack).toBeTruthy();

    const spawns = await readTable(page, "spawns");
    const spawn = spawns.find((s) => Number(s.spawnId) === SPAWN_ID);
    expect(spawn.tankId).toBe(fryRack.id);

    // Checkpoints: a headcount, and a `moved` that carries NO count.
    const checkpoints = (await readTable(page, "spawnGrowout"))
      .filter((c) => Number(c.spawnId) === SPAWN_ID);
    const fryCount = checkpoints.filter((c) => c.type === "fry_count");
    const moved = checkpoints.filter((c) => c.type === "moved");
    expect(fryCount).toHaveLength(1);
    expect(fryCount[0].count).toBe(120);
    expect(moved).toHaveLength(1);
    expect(moved[0].count).toBe(0);
    expect(moved[0].note).toMatch(/from tank 5000/);

    // No certificates were created — a cohort is counts, not certificates.
    const specimens = (await readTable(page, "specimens"))
      .filter((s) => String(s.ownerAddress).toLowerCase() === E2E_STUB_ACCOUNT);
    expect(specimens).toHaveLength(0);

    // And the move did not reduce the living population: 120 in, 120 alive.
    await expect(page.getByText("120").first()).toBeVisible();
  });
});
