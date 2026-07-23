/**
 * Source-guards for PwaManager.jsx (Task 21D audit). Verifies the install
 * prompt is suppressed when the app is already running standalone, and the
 * update flow is wired through `useRegisterSW` with `registerType: 'prompt'`
 * semantics (the actual browser-level install/update behavior can't be
 * exercised without a real browser — see docs/PWA_MIGRATION_PROGRESS.md for
 * what still needs manual device testing).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./PwaManager.jsx", import.meta.url)),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("PwaManager — install prompt suppressed when already standalone", () => {
  it("defines isStandalone() checking both display-mode:standalone and iOS's navigator.standalone", () => {
    expect(SOURCE).toContain("function isStandalone()");
    const idx = SOURCE.indexOf("function isStandalone()");
    const block = SOURCE.slice(idx, idx + 300);
    expect(block).toContain("display-mode: standalone");
    expect(block).toContain("navigator.standalone");
  });

  it("guards the beforeinstallprompt/iOS-hint effect behind isStandalone(), returning early when true", () => {
    const idx = SOURCE.indexOf("useEffect(() => {\n    if (isStandalone())");
    // Allow for minor formatting differences by searching more loosely too.
    const found = idx > -1 || /useEffect\(\(\) => \{\s*if \(isStandalone\(\)\) return;/.test(SOURCE);
    expect(found).toBe(true);
  });
});

describe("PwaManager — update flow wired via useRegisterSW (registerType: 'prompt')", () => {
  it("imports useRegisterSW from the vite-plugin-pwa virtual module", () => {
    expect(SOURCE).toContain('import { useRegisterSW } from "virtual:pwa-register/react";');
  });

  it("destructures needRefresh/setNeedRefresh and updateServiceWorker, and calls updateServiceWorker(true) on Reload", () => {
    expect(SOURCE).toContain("needRefresh: [needRefresh, setNeedRefresh]");
    expect(SOURCE).toContain("updateServiceWorker,");
    expect(SOURCE).toContain("updateServiceWorker(true)");
  });

  it("actively polls registration.update() on focus, visibility change, and a 30-minute interval", () => {
    expect(SOURCE).toContain('window.addEventListener("focus", checkForUpdate)');
    expect(SOURCE).toContain('document.addEventListener("visibilitychange"');
    expect(SOURCE).toContain("setInterval(checkForUpdate, 30 * 60 * 1000)");
  });

  it("the update prompt takes priority over install prompts (checked first in the render)", () => {
    const updateIdx = SOURCE.indexOf("if (needRefresh) {");
    const installIdx = SOURCE.indexOf("if (installEvent) {");
    expect(updateIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeLessThan(installIdx);
  });
});

describe("PwaManager — iOS Add-to-Home-Screen hint (no beforeinstallprompt on iOS)", () => {
  it("detects iOS via user agent and dismissal is remembered in localStorage", () => {
    expect(SOURCE).toContain("function isIosDevice()");
    expect(SOURCE).toContain("IOS_HINT_DISMISS_KEY");
    expect(SOURCE).toContain("localStorage.getItem(IOS_HINT_DISMISS_KEY)");
    expect(SOURCE).toContain("localStorage.setItem(IOS_HINT_DISMISS_KEY, \"1\")");
  });
});
