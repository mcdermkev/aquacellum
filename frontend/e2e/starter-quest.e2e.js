// e2e/starter-quest.e2e.js — the Casual first-run activation checklist, plus
// regression cover for the legacy onboarding surfaces that were retired
// alongside it (OnboardingWizard, ReefOnboarding, the "Welcome aboard" modal and
// the Settings "Replay Onboarding" control).
import { test, expect } from "@playwright/test";
import { gotoDashboard, seed, reloadDashboard, DESKTOP_ONLY_REASON } from "./helpers.js";

test.describe("Starter Quest", () => {
  test("Q1. renders in the Profile hub with nothing completed on a fresh account", async ({ page }) => {
    await gotoDashboard(page, { casual: true });
    await page.goto("/app/profile?e2e=1");

    await expect(page.getByText(/Starter Quest/i)).toBeVisible();
    await expect(page.getByText("0/5")).toBeVisible();

    // All five steps are listed.
    await expect(page.getByText(/Set up your first aquarium/i)).toBeVisible();
    await expect(page.getByText(/Log a water test/i)).toBeVisible();
    await expect(page.getByText(/Add your first fish/i)).toBeVisible();
    await expect(page.getByText(/Post to The Reef/i)).toBeVisible();
    await expect(page.getByText(/Browse the marketplace/i)).toBeVisible();
  });

  test("Q2. seeds tank+fish for a returning keeper and ticks the marketplace visit", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", DESKTOP_ONLY_REASON);
    await gotoDashboard(page, { casual: true });
    // A keeper who already owns a species has clearly set up a tank and added a
    // fish in a prior session, so those two steps must not read as undone.
    await seed(page, {
      tanks: [{ name: "Existing Tank", volumeLiters: 75, specimens: [{ speciesId: 1, commonName: "Guppy" }] }],
    });
    await reloadDashboard(page);

    await page.goto("/app/profile?e2e=1");
    await expect(page.getByText("2/5")).toBeVisible();

    // Tapping an unfinished step routes to where it can be completed, and
    // visiting the marketplace is itself the completion signal.
    await page.getByRole("button", { name: /Browse the marketplace/i }).click();
    await expect(page).toHaveURL(/\/app\/directory/);

    await page.goto("/app/profile?e2e=1");
    await expect(page.getByText("3/5")).toBeVisible();
    // The completed step no longer offers its hint copy.
    await expect(page.getByText(/See what breeders are offering/i)).toHaveCount(0);
  });

  test("Q3. quest progress survives a reload (localStorage-persisted)", async ({ page }) => {
    await gotoDashboard(page, { casual: true });
    await page.goto("/app/directory?e2e=1");
    await page.goto("/app/profile?e2e=1");
    await expect(page.getByText("1/5")).toBeVisible();

    await page.reload();
    await expect(page.getByText("1/5")).toBeVisible();
  });
});

test.describe("Retired onboarding surfaces stay gone", () => {
  test("Q4. no welcome modal or onboarding wizard on the Casual dashboard", async ({ page }) => {
    await gotoDashboard(page, { casual: true });
    await seed(page, { tanks: [{ name: "Existing Tank", volumeLiters: 75 }] });
    await reloadDashboard(page);

    // The inert "Welcome aboard" modal and the wizard's Poseidon intro are both
    // unmounted; neither may reappear.
    await expect(page.getByText(/Welcome aboard/i)).toHaveCount(0);
    await expect(page.getByText(/Let's set up your first tank/i)).toHaveCount(0);
  });

  test("Q5. Settings no longer offers Replay Onboarding", async ({ page }) => {
    await gotoDashboard(page, { casual: true });
    await page.goto("/app/settings?e2e=1");
    await expect(page.getByText(/Replay Onboarding/i)).toHaveCount(0);
  });
});

test.describe("Header user menu", () => {
  // Regression: the dropdown rendered UNDER the tab strip on desktop. It used
  // `position: fixed; zIndex: 9999`, but the header's `.glass-card` has
  // `backdrop-filter`, which makes it the containing block AND a stacking context
  // for fixed descendants — so the z-index was resolved inside the header and the
  // nav strip painted over it. Fixed by portalling the menu to document.body.
  //
  // This asserts it by CLICKING a menu item: Playwright refuses to click an
  // element another element covers, so a covered menu fails here.
  test("Q6. the profile dropdown is not covered by the nav strip", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", DESKTOP_ONLY_REASON);
    await gotoDashboard(page, { casual: false });
    await seed(page, { tanks: [{ name: "Existing Tank", volumeLiters: 75 }] });
    await reloadDashboard(page);

    await page.getByRole("button", { name: "User menu" }).click();

    const menu = page.getByRole("menu", { name: "User menu" });
    await expect(menu).toBeVisible();

    // THE SYMPTOM, asserted first: whatever sits at the menu item's centre point
    // must be the menu item itself. When the nav strip painted over the menu,
    // elementFromPoint returned the nav — a menu you can see but cannot click.
    const item = menu.getByRole("menuitem", { name: /View Profile/i });
    await expect(item).toBeVisible();
    const coveredBy = await item.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (el === top || el.contains(top)) return null;
      return top ? `${top.tagName}.${top.className || "(no class)"}`.slice(0, 80) : "nothing";
    });
    expect(coveredBy, "the profile menu item is covered by another element").toBeNull();

    // And the mechanism: the portal puts it directly under <body>, outside the
    // header's stacking context. Raising the z-index alone could never work.
    await expect(menu.evaluate((el) => el.parentElement === document.body)).resolves.toBe(true);

    // Finally, it must be genuinely clickable (Playwright refuses covered targets).
    await item.click();
  });
});
