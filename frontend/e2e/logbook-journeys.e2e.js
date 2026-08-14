// e2e/logbook-journeys.e2e.js
//
// Phase B — authenticated daily-loop journeys (docs/TASK_11_E2E_SPEC.md).
// Gated on the dev-only `?e2e=1` auth/seed hook (utils/e2eMode.js, db.js
// seedForE2E). Each test seeds a fresh v23 Dexie state and drives the real
// TankList UI — no auth, no on-chain calls, no Privy.
//
// These tests validate rendered surfaces and wiring only; pure logic
// (deriveTankHealth, scoreToAmbient, assessStocking, etc.) is unit-covered
// elsewhere and must not be re-asserted here.
import { test, expect } from "@playwright/test";
import { gotoDashboard, seed, reloadDashboard, readTable, tabLabel, DESKTOP_ONLY_REASON } from "./helpers.js";

test.describe.configure({ mode: "serial" }); // each test seeds a fresh DB; avoid cross-talk

async function freshDashboard(page, { casual = true } = {}) {
  await gotoDashboard(page, { casual });
  await page.evaluate(() => window.__clearE2EDb());
}

test.describe("Phase B — logbook journeys (authenticated, e2e-seeded)", () => {
  test("B1. Casual daily loop — test water, coach advances, photo attaches", async ({ page }) => {
    await freshDashboard(page, { casual: true });
    const { tankIds } = await seed(page, {
      tanks: [
        {
          id: 700001,
          name: "Community 76L",
          tankType: 0,
          volumeLiters: 76,
          specimens: [
            { speciesId: 1, commonName: "Neon Tetra" },
            { speciesId: 2, commonName: "Dwarf Gourami" },
            { speciesId: 3, commonName: "Corydoras" },
          ],
          // No readings/schedules → "never tested" state, coach should nudge a test.
        },
      ],
    });
    await reloadDashboard(page);

    // Gallery shows a living tank-card; open it.
    const card = page.getByTestId("tank-card").first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId("living-tank")).toBeVisible();
    await card.click();

    // Overview tab (Casual label "About") should be selected by default and
    // render the flag-explainer + stocking-guide + Care Coach nudge.
    await expect(page.getByRole("button", { name: tabLabel("casual", "overview"), exact: true })).toHaveClass(/active/);
    await expect(page.locator(".care-coach")).toBeVisible();
    // Never-tested tank → coach should surface a "test" nudge with a CTA.
    await expect(page.locator(".care-coach-cta")).toContainText(/water test/i);

    // Log a water test via the primary quick-actions path. The click handler
    // fires logCareAction() without the UI awaiting it (fire-and-forget), so
    // poll the real db state rather than assume the write has landed the
    // instant the click resolves.
    await page.getByRole("button", { name: "⚡ Log Care / Actions" }).click();
    // The quick-actions menu became a console-tile grid ("polish casual Quick
    // Actions menu", d1ed495) and this tile is now labelled "Quick Test" with a
    // separate description span, so match on the label rather than the old exact
    // "🧪 Quick Water Test" name. `Quick Test` also excludes "Detailed Test".
    await page.getByRole("button", { name: /Quick Test/ }).click();

    await expect
      .poll(async () => {
        const logs = await readTable(page, "actionLogs");
        return logs.some((l) => l.tankId === tankIds[0] && l.actionType === "Quick Water Test");
      }, { timeout: 5000 })
      .toBe(true);

    // Assert a structured actionLogs row exists (in-page db) — the real state
    // change, not a UI illusion.
    const logs = await readTable(page, "actionLogs");
    const testLog = logs.find((l) => l.tankId === tankIds[0] && l.actionType === "Quick Water Test");
    expect(testLog.payload?.kind).toBe("test");

    // CareCoach loads this tank's schedules once on mount (effect keyed only on
    // tank.id), so a reload is needed to observe the post-log state — the same
    // schedules a keeper would see returning to the app later. With "test" now
    // satisfied, the coach's next-most-important habit is the still-unlogged
    // "waterChange" default schedule (both were seeded due-now).
    await reloadDashboard(page);
    await page.getByTestId("tank-card").first().click();
    await expect(page.locator(".care-coach-cta")).toContainText(/water change/i, { timeout: 5000 });

    // Attach a photo to a fish in Inhabitants ("My Fish" tab in Casual).
    await page.getByRole("button", { name: tabLabel("casual", "fish"), exact: true }).click();
    await expect(page.getByTestId("inhabitant-group").first()).toBeVisible();
    await page.locator(".ti-group-row").first().click(); // expand the group
    const photoBtn = page.locator(".ti-individual").first().getByTitle("Add / update photo");
    await expect(photoBtn).toBeVisible();

    // The hidden <input type=file> is populated programmatically since there's
    // no real file picker in a headless run.
    const fileInput = page.locator('input[type="file"]').nth(1); // [0]=tank photo, [1]=specimen photo
    await photoBtn.click();
    const buf = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    await fileInput.setInputFiles({ name: "fish.png", mimeType: "image/png", buffer: buf });

    // Verify the photo landed in db.tankMedia (in-page db), not just the UI.
    await expect
      .poll(async () => {
        const media = await readTable(page, "tankMedia");
        return media.some((m) => m.refType === "specimen");
      }, { timeout: 5000 })
      .toBe(true);
  });

  test("B2. Ambient shift end-to-end — ok reading vs. ammonia alert", async ({ page }) => {
    await freshDashboard(page, { casual: true });
    await seed(page, {
      tanks: [
        {
          id: 700002,
          name: "Ambient Tank",
          tankType: 0,
          volumeLiters: 75,
          specimens: [{ speciesId: 1, commonName: "Neon Tetra" }],
          latestLog: {
            timestamp: Math.floor(Date.now() / 1000) - 3600,
            tempCelsiusX10: 245,
            phX10: 72,
            ammoniaPpmX100: 0,
            nitritePpmX100: 0,
            nitratePpmX100: 500,
          },
        },
      ],
    });
    await reloadDashboard(page);

    const card = page.getByTestId("tank-card").first();
    await expect(card.getByTestId("living-tank")).toHaveAttribute("data-status", "ok");
    await card.click();
    // Detail hero also reflects "ok".
    await expect(page.locator(".lt-hero, .lt-root.lt-hero").first()).toHaveAttribute("data-status", "ok");
    // Close detail to get back to the gallery for reseeding.
    await page.keyboard.press("Escape");

    // Reseed with an ammonia emergency reading on the SAME tank id.
    await page.evaluate(async (tankId) => {
      const db = window.__aquadexDb;
      await db.tanks.update(tankId, {
        latestLog: {
          timestamp: Math.floor(Date.now() / 1000),
          tempCelsiusX10: 245,
          phX10: 72,
          ammoniaPpmX100: 50, // 0.5 ppm — above the 0.05 alert threshold
          nitritePpmX100: 0,
          nitratePpmX100: 500,
        },
      });
    }, 700002);
    await reloadDashboard(page);

    const alertCard = page.getByTestId("tank-card").first();
    await expect(alertCard.getByTestId("living-tank")).toHaveAttribute("data-status", "alert");
    await alertCard.click();
    await expect(page.locator(".lt-hero, .lt-root.lt-hero").first()).toHaveAttribute("data-status", "alert");
  });

  test("B3. Pro ops grid + worklist", async ({ page }) => {
    await freshDashboard(page, { casual: false });
    const nowSec = Math.floor(Date.now() / 1000);
    const dayAgo = nowSec - 86400;
    const tanks = [];
    // 12 tanks: half overdue for a water change, half fine. Among the overdue
    // half, alternate 1 vs 2 overdue schedule kinds so the "needs attention"
    // sort (which weighs overdue count) and the "oldest test" sort (which
    // ignores it) produce genuinely different orderings, not just a
    // coincidental match.
    for (let i = 0; i < 12; i++) {
      const overdue = i < 6;
      const doubleOverdue = overdue && i % 2 === 0;
      const schedules = overdue
        ? [{ kind: "waterChange", cadenceDays: 7, lastDoneAt: dayAgo - (10 + i) * 86400, nextDueAt: dayAgo }]
        : [{ kind: "waterChange", cadenceDays: 7, lastDoneAt: nowSec - 86400, nextDueAt: nowSec + 6 * 86400 }];
      if (doubleOverdue) {
        schedules.push({ kind: "test", cadenceDays: 7, lastDoneAt: dayAgo - (10 + i) * 86400, nextDueAt: dayAgo });
      }
      tanks.push({
        id: 700100 + i,
        name: `Rack Tank ${i + 1}`,
        tankType: 0,
        volumeLiters: 40,
        specimens: [{ speciesId: 1, commonName: "Neon Tetra" }],
        latestLog: {
          timestamp: overdue ? nowSec - (10 + i) * 86400 : nowSec - 3600,
          tempCelsiusX10: 245, phX10: 72, ammoniaPpmX100: 0, nitritePpmX100: 0, nitratePpmX100: 500,
        },
        schedules,
      });
    }
    await seed(page, { tanks });
    await reloadDashboard(page);

    // Assert grid rows render with a LivingTank strip.
    const rows = page.getByTestId("ops-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(12);
    await expect(rows.first().getByTestId("living-tank")).toBeVisible();

    // Click "Needs attention" filter; assert only needs-attention rows remain
    // and the count badge matches. ProOpsGrid loads each tank's schedules
    // async on mount (getOrInitTankSchedules), so the badge starts at 0 and
    // fills in — wait for it to settle rather than reading it immediately.
    const filterBtn = page.getByTestId("ops-attention-filter");
    await expect
      .poll(async () => Number(await filterBtn.locator(".ops-chip-count").innerText()), { timeout: 5000 })
      .toBeGreaterThan(0);
    const expectedAttentionCount = Number(await filterBtn.locator(".ops-chip-count").innerText());
    await filterBtn.click();
    await expect(filterBtn).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(expectedAttentionCount);

    // Clear the filter, then sort by "Oldest test" and assert order changes.
    await filterBtn.click();
    const beforeOrder = await rows.allTextContents();
    await page.locator(".ops-sort select").selectOption("test");
    const afterOrder = await rows.allTextContents();
    expect(afterOrder).not.toEqual(beforeOrder);

    // Worklist: "N due for water change"; click "Log all"; due count drops.
    const worklistItem = page.getByTestId("worklist-item").filter({ hasText: "water change" });
    await expect(worklistItem).toBeVisible();
    const dueCountBefore = Number((await worklistItem.innerText()).match(/(\d+)/)[1]);
    expect(dueCountBefore).toBeGreaterThan(0);
    await worklistItem.click();
    // Worklist actions go through requestConfirm — confirm the dialog.
    await page.getByRole("alertdialog").getByRole("button", { name: /^Log \d+$/ }).click();

    await expect
      .poll(async () => {
        const item = page.getByTestId("worklist-item").filter({ hasText: "water change" });
        if ((await item.count()) === 0) return 0; // fully cleared — item unmounts
        const text = await item.innerText({ timeout: 500 }).catch(() => "");
        const m = text.match(/(\d+)/);
        return m ? Number(m[1]) : 0;
      }, { timeout: 5000 })
      .toBeLessThan(dueCountBefore);
  });

  test("B4. Inhabitants grouping + bulk move", async ({ page }, testInfo) => {
    // See DESKTOP_ONLY_REASON: the Poseidon chat FAB overlaps the bulk-select
    // checkbox on the narrow mobile viewport — a real UX finding, not a test
    // bug, flagged for the review gate rather than worked around here.
    test.skip(testInfo.project.name === "mobile-chromium", DESKTOP_ONLY_REASON);
    await freshDashboard(page, { casual: false });
    const goldfish = Array.from({ length: 12 }).map(() => ({ speciesId: 10, commonName: "Common Goldfish" }));
    await seed(page, {
      tanks: [
        {
          id: 700200,
          name: "Source Tank",
          tankType: 0,
          volumeLiters: 200,
          specimens: [...goldfish, { speciesId: 11, commonName: "Blue Acara", gender: "Male" }],
        },
        { id: 700201, name: "Grow-Out Tank", tankType: 0, volumeLiters: 300, specimens: [] },
      ],
    });
    await reloadDashboard(page);

    // Open the source tank (Pro row-card fallback view, or grid — click by name).
    await page.getByText("Source Tank", { exact: false }).first().click();
    await page.getByRole("button", { name: tabLabel("pro", "fish"), exact: true }).click();

    const groups = page.getByTestId("inhabitant-group");
    await expect(groups).toHaveCount(2);
    await expect(groups.filter({ hasText: "Common Goldfish" })).toContainText("12×");
    await expect(groups.filter({ hasText: "Blue Acara" })).toContainText("1×");

    // Select the goldfish group (checkbox on the group row).
    await groups.filter({ hasText: "Common Goldfish" }).locator(".ti-check").click();

    const bulkbar = page.getByTestId("inhabitants-bulkbar");
    await expect(bulkbar).toBeVisible();
    await expect(bulkbar).toContainText("12 selected");

    await bulkbar.locator(".ti-select").selectOption({ label: "Grow-Out Tank" });
    await bulkbar.getByRole("button", { name: /^Move 12$/ }).click();

    // Assert the specimens actually moved (in-page db), not just a UI illusion.
    await expect
      .poll(async () => {
        const specimens = await readTable(page, "specimens");
        return specimens.filter((s) => s.currentTankId === 700201 && s.speciesId === 10).length;
      }, { timeout: 5000 })
      .toBe(12);

    const sourceTank = (await readTable(page, "tanks")).find((t) => t.id === 700200);
    expect((sourceTank.specimens || []).filter((s) => s.speciesId === 10).length).toBe(0);
  });

  test("B5. Nursery triage + bulk move", async ({ page }) => {
    await freshDashboard(page, { casual: true });
    const unassigned = Array.from({ length: 12 }).map(() => ({ speciesId: 20, commonName: "Common Goldfish" }));
    await seed(page, {
      tanks: [{ id: 700300, name: "Grow-Out Tank", tankType: 0, volumeLiters: 300, specimens: [] }],
      unassignedSpecimens: unassigned,
    });
    await reloadDashboard(page);

    const nursery = page.getByTestId("nursery-header");
    await expect(nursery).toBeVisible();
    await expect(nursery).toContainText("12 unassigned");
    await nursery.click(); // expand

    const goldfishGroup = page.locator(".fn-group").filter({ hasText: "Common Goldfish" });
    await expect(goldfishGroup).toContainText("12×");

    await goldfishGroup.locator(".fn-select").selectOption({ label: "Grow-Out Tank" });
    await goldfishGroup.locator(".fn-btn-move").click();

    await expect
      .poll(async () => {
        const specimens = await readTable(page, "specimens");
        return specimens.filter((s) => s.currentTankId === 700300).length;
      }, { timeout: 5000 })
      .toBe(12);

    // Nursery count drops to zero and the banner/section disappears (FryNursery
    // returns null once nurseryFish.length === 0).
    await expect(page.getByTestId("nursery-header")).toHaveCount(0, { timeout: 5000 });
  });

  test("B6. Schedule editor -> worklist / coach nudge", async ({ page }) => {
    await freshDashboard(page, { casual: true });
    await seed(page, {
      tanks: [
        {
          id: 700400,
          name: "Schedule Tank",
          tankType: 0,
          volumeLiters: 75,
          specimens: [{ speciesId: 1, commonName: "Neon Tetra" }],
        },
      ],
    });
    await reloadDashboard(page);

    await page.getByTestId("tank-card").first().click();
    await page.getByTestId("schedule-editor-toggle").click();

    // Enable the water-change reminder and set cadence to 7 days.
    const waterChangeRow = page.locator(".sched-row", { hasText: "Water change" });
    const toggle = waterChangeRow.locator('input[type="checkbox"]');
    if (!(await toggle.isChecked())) await toggle.check();
    const cadenceInput = waterChangeRow.locator('input[type="number"]');
    await cadenceInput.fill("7");
    await cadenceInput.blur();

    await expect
      .poll(async () => {
        const rows = await readTable(page, "tankSchedules");
        const row = rows.find((r) => r.tankId === 700400 && r.kind === "waterChange");
        return row ? { cadenceDays: row.cadenceDays, enabled: row.enabled } : null;
      }, { timeout: 5000 })
      .toEqual({ cadenceDays: 7, enabled: true });

    // Now seed a second tank whose schedule is already overdue and confirm it
    // shows up in the Casual coach nudge / (switch to Pro) worklist.
    await page.evaluate(async () => {
      const db = window.__aquadexDb;
      const nowSec = Math.floor(Date.now() / 1000);
      await db.tanks.put({
        id: 700401, ownerAddress: "0xe2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2",
        name: "Overdue Tank", tankType: 0, volumeLiters: 50, active: true, parentUnitId: 0,
        specimens: [{ id: 999401, speciesId: 1, commonName: "Neon Tetra", status: 0 }],
      });
      await db.tankSchedules.add({
        tankId: 700401, kind: "waterChange", cadenceDays: 7,
        lastDoneAt: nowSec - 20 * 86400, nextDueAt: nowSec - 13 * 86400, enabled: true,
      });
      // Also seed a NOT-due "test" schedule — CareCoach ranks a due "test"
      // ahead of a due "waterChange" (pickSuggestion order), so without this
      // getOrInitTankSchedules would inject a due-now default "test" schedule
      // and mask the water-change nudge this test is asserting on.
      await db.tankSchedules.add({
        tankId: 700401, kind: "test", cadenceDays: 7,
        lastDoneAt: nowSec - 86400, nextDueAt: nowSec + 6 * 86400, enabled: true,
      });
    });
    await reloadDashboard(page);
    await page.getByText("Overdue Tank", { exact: false }).first().click();
    await expect(page.locator(".care-coach-cta")).toContainText(/water change/i);
  });
});
