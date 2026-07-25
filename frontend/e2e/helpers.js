// e2e/helpers.js — shared setup for Phase B authenticated-journey tests.
//
// The dev-only `?e2e=1` flag (utils/e2eMode.js) makes AuthContext report a
// stub account as already authenticated, skipping Privy entirely. Combined
// with `aquadex_entered_dashboard`/`aquadex_casual_mode` in localStorage (the
// same flags the real landing pages + mode toggle write), this lands directly
// on the authenticated /app/tanks dashboard with no login flow. Seeding goes
// straight into Dexie via `window.__seedForE2E` (exposed dev-only in db.js).
export const E2E_STUB_ACCOUNT = "0xe2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2";

/**
 * Reason string for `test.skip(condition, reason)` on Phase B tests that only
 * need to run once, on desktop. Per docs/TASK_11_E2E_SPEC.md, Phase B's
 * mobile-viewport requirement is scoped to specific cross-cutting passes
 * (many-tanks performance, one reduced-motion pass), not every daily-loop
 * journey. Usage in a test:
 *   test("B4. ...", async ({ page }, testInfo) => {
 *     test.skip(testInfo.project.name === "mobile-chromium", DESKTOP_ONLY_REASON);
 *     ...
 *
 * NOTE (review finding, not fixed here): running B4 on `mobile-chromium`
 * surfaced that the floating Poseidon chat FAB (`.poseidon-global-fab`)
 * overlaps the Inhabitants bulk-select checkbox at some scroll positions on a
 * narrow viewport, blocking the click. Worth a UX pass (raise the FAB's
 * z-index scope or reserve safe-area padding at the bottom of scrollable
 * panels) — flagging for the Opus review gate rather than patching UI here.
 */
export const DESKTOP_ONLY_REASON = "Phase B desktop-only for this journey (see e2e/helpers.js DESKTOP_ONLY_REASON)";

/**
 * Navigate to the authenticated logbook dashboard in the given mode.
 * @param {import('@playwright/test').Page} page
 * @param {{ casual?: boolean }} [opts]
 */
export async function gotoDashboard(page, { casual = true } = {}) {
  await page.addInitScript((casualVal) => {
    window.localStorage.setItem("aquadex_entered_dashboard", "true");
    window.localStorage.setItem("aquadex_casual_mode", casualVal ? "true" : "false");
    // Suppress the "What's New" changelog modal (WhatsNewModal.jsx) and the
    // onboarding-tour "beta welcome" one-time popups — neither is under test
    // here and both intercept clicks with a fullscreen backdrop.
    window.localStorage.setItem("aquadex_last_seen_version", "0.9.1");
  }, casual);
  await page.goto("/app/tanks?e2e=1");
  await page.waitForFunction(() => typeof window.__seedForE2E === "function");
}

/**
 * Seed Dexie directly (bypasses UI/relayer) for a deterministic starting state.
 * See db.js `seedForE2E` for the fixture shape.
 * @param {import('@playwright/test').Page} page
 * @param {object} fixture
 */
export async function seed(page, fixture) {
  return page.evaluate((f) => window.__seedForE2E(f), fixture);
}

/** Reload so the app's queries (useUserTanks etc.) re-mount against seeded data. */
export async function reloadDashboard(page) {
  await page.reload();
  await page.getByText("AQUADEX", { exact: true }).first().waitFor({ state: "visible" });
}

/** Read a Dexie table (or a filtered slice of it) from in-page state for assertions. */
export async function readTable(page, tableName) {
  return page.evaluate((name) => window.__aquadexDb[name].toArray(), tableName);
}

/** Tab label map — Overview/Fish/History have mode-specific copy (TankList.jsx). */
export const TAB_LABELS = {
  casual: { overview: "About", fish: "My Fish", history: "Journal" },
  pro: { overview: "Overview", fish: "Specimens", history: "History" },
};

export function tabLabel(mode, key) {
  return TAB_LABELS[mode][key];
}
