/**
 * e2eMode.js — Test-only entry flag for the Playwright Phase B auth/seed hook
 * (docs/TASK_11_E2E_SPEC.md, "The auth + seed problem"). Mirrors the existing
 * `?preview=living-tank` pattern: a URL flag that only ever does anything in a
 * dev build (`import.meta.env.DEV`), so it cannot activate in a production
 * bundle regardless of what query string a request carries. `import.meta.env.DEV`
 * is a build-time constant inlined by Vite — `npm run build` produces `false`
 * here unconditionally, so this branch is dead code (and the flag check itself
 * is stripped) in every production bundle.
 *
 * Consumers:
 *   - AuthContext.jsx — when active, exposes a stub account/authenticated
 *     state instead of going through Privy, so the dashboard renders without
 *     a real login.
 *   - App.jsx — skips the Supabase cloud-sync push/pull for the stub account
 *     (there's nothing real to sync, and we don't want to write test data to
 *     the real Supabase project under a fake wallet address).
 *   - db.js — exposes the live Dexie instance on `window.__aquadexDb` so tests
 *     can seed/read tanks, specimens, schedules, etc. directly via
 *     `page.evaluate`, per the spec's "Dexie is reachable in-page" guidance.
 */
export function isE2EMode() {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("e2e") === "1";
  } catch {
    return false;
  }
}

/** Stub wallet address used for the whole session when E2E mode is active. */
export const E2E_STUB_ACCOUNT = "0xe2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2";
