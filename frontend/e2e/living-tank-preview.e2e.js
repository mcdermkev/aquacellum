// e2e/living-tank-preview.e2e.js
//
// Phase A — preview-route tests (no auth, CI-safe). See docs/TASK_11_E2E_SPEC.md.
//
// Target: `/?preview=living-tank`, which App.jsx short-circuits to
// LivingTankPreview — mock data + live controls, no wallet, no Dexie writes.
// These tests validate rendered surfaces only; pure logic (deriveTankHealth,
// scoreToAmbient, etc.) is unit-covered elsewhere and must not be re-asserted
// here.
import { test, expect } from "@playwright/test";

// The preview short-circuit lives in App.jsx, which mounts under the React SPA
// shell (/app.html, dev-rewritten from /app — see vite.config.js
// storefrontRewritePlugin). The bare `/` is the static marketing landing page
// and does not mount App.jsx at all.
const PREVIEW_URL = "/app?preview=living-tank";

// Benign, environment-driven console noise to ignore. Phase A asserts that OUR
// preview UI renders without errors — not that keyless third-party endpoints
// (chain RPCs, Privy/PostHog/Supabase) allow CORS from a sandboxed CI browser.
// Locally these succeed via .env config; in CI they fail (no secrets), which is
// expected and unrelated to the component under test.
const IGNORED_ERROR_PATTERNS = [
  /Failed to load resource/i,
  /Access-Control-Allow-Origin/i,
  /blocked by CORS policy/i,
  /ERR_FAILED/i,
  /net::ERR_/i,
  /blockpi\.network|base-sepolia|publicnode|rpc/i,
  /privy|posthog|supabase/i,
];

function isBenignError(text) {
  return IGNORED_ERROR_PATTERNS.some((re) => re.test(text));
}

/** Attach a console-error collector (app errors only); returns the array to assert on. */
function trackConsoleErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !isBenignError(msg.text())) errors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    const text = String(err);
    if (!isBenignError(text)) errors.push(text);
  });
  return errors;
}

test.describe("Phase A — Living Tank preview (no auth)", () => {
  test("A1. Variants render across tank types, no console errors", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(PREVIEW_URL);

    // The card, hero, and strip variants of the same mock tank are all visible.
    const livingTanks = page.getByTestId("living-tank");
    await expect(livingTanks.first()).toBeVisible();
    const initialCount = await livingTanks.count();
    expect(initialCount).toBeGreaterThanOrEqual(3); // card + hero + at least one strip

    // Water-type buttons render from TYPES = [Freshwater, Brackish, Pond].
    for (const label of ["Freshwater", "Brackish", "Pond"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      // Instances remain visible after switching tank type.
      await expect(livingTanks.first()).toBeVisible();
      expect(await livingTanks.count()).toBe(initialCount);
    }

    expect(errors, `Unexpected console errors: ${errors.join("\n")}`).toEqual([]);
  });

  test("A2. Ambient responds to health (status copy changes with the slider)", async ({ page }) => {
    await page.goto(PREVIEW_URL);

    const slider = page.locator('input[type="range"]').first();
    await expect(slider).toBeVisible();

    // scoreToAmbient: score/100 >= 0.7 -> ok, >= 0.4 -> drifting, else alert.
    await slider.fill("90");
    await expect(page.getByText(/Healthy — clear water, fish lively/)).toBeVisible();

    await slider.fill("55");
    await expect(page.getByText(/Drifting — water hazing, fish slowing/)).toBeVisible();

    await slider.fill("15");
    await expect(page.getByText(/Alert — murky water, sluggish fish/)).toBeVisible();

    // The status color/text node actually changes (not just static copy) — the
    // "Card variant" LivingTank instance's data-status attribute tracks the slider.
    const cardVariant = page.getByTestId("living-tank").first();
    await expect(cardVariant).toHaveAttribute("data-status", "alert");
    await slider.fill("90");
    await expect(cardVariant).toHaveAttribute("data-status", "ok");
  });

  test("A3. Fish count never exceeds the engine's maxVisible cap", async ({ page }) => {
    await page.goto(PREVIEW_URL);

    const fishCountSlider = page.locator('input[type="range"]').nth(1);
    await fishCountSlider.fill("20");

    // The "Card variant" LivingTank (first `living-tank` instance) exposes its
    // cap via data-max-fish on the fish layer; read it rather than hardcoding
    // a guess, then assert the rendered fish node count never exceeds it.
    const cardVariant = page.getByTestId("living-tank").first();
    const fishLayer = cardVariant.locator(".lt-fish");
    await expect(fishLayer).toBeVisible();
    const maxFish = Number(await fishLayer.getAttribute("data-max-fish"));
    expect(maxFish).toBeGreaterThan(0);

    const renderedFish = fishLayer.locator(".tank-fish-visualization > div");
    const renderedCount = await renderedFish.count();
    expect(renderedCount).toBeLessThanOrEqual(maxFish);
  });

  test("A4. Reduced motion — static fallback, no animation loop", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = trackConsoleErrors(page);
    await page.goto(PREVIEW_URL);

    const livingTanks = page.getByTestId("living-tank");
    await expect(livingTanks.first()).toBeVisible();

    // Every visible LivingTank instance should report data-animated="false"
    // under reduced motion (LivingTank.jsx: `animate = inView && !reducedMotion`).
    const count = await livingTanks.count();
    for (let i = 0; i < count; i++) {
      await expect(livingTanks.nth(i)).toHaveAttribute("data-animated", "false");
    }

    expect(errors).toEqual([]);
    await context.close();
  });

  test("A5. No console errors / no unexpected layout shift across type switches", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(PREVIEW_URL);

    const grid = page.getByTestId("tank-card").first();
    // Casual gallery may take a tick to mount; wait for at least one card.
    await expect(grid).toBeVisible();

    const boxBefore = await grid.boundingBox();
    await page.getByRole("button", { name: "Brackish", exact: true }).click();
    await page.getByRole("button", { name: "Pond", exact: true }).click();
    await page.getByRole("button", { name: "Freshwater", exact: true }).click();
    const boxAfter = await grid.boundingBox();

    expect(boxBefore).not.toBeNull();
    expect(boxAfter).not.toBeNull();
    // Position/size of the first gallery card should be stable across type
    // switches (this is a regression tripwire against layout jumps, not a
    // pixel-perfect check).
    expect(Math.abs(boxAfter.x - boxBefore.x)).toBeLessThan(2);
    expect(Math.abs(boxAfter.y - boxBefore.y)).toBeLessThan(2);
    expect(Math.abs(boxAfter.width - boxBefore.width)).toBeLessThan(2);

    expect(errors, `Unexpected console errors: ${errors.join("\n")}`).toEqual([]);
  });
});
