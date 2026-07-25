// playwright.config.js
//
// Task 11 E2E harness (see docs/TASK_11_E2E_SPEC.md). Two projects: a desktop
// chromium pass and a phone-sized pass (Pixel 7) for the many-tanks / mobile
// journeys. `reducedMotion` is intentionally NOT set here — Phase A/B tests
// that need it open their own context with `reducedMotion: "reduce"` per-test
// (see e2e/living-tank-preview.e2e.js A4).
import { defineConfig, devices } from "@playwright/test";

// vite.config.js pins the dev server to port 4200 (see `server.port`).
const PORT = 4200;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.js",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    // Plain `vite` (no vercel dev proxy) — Phase A/B do not need /api.
    command: "npm run dev:vite",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
