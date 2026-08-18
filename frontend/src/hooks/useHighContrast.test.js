/**
 * Unit tests for useHighContrast.js (Task 21D). This repo's vitest runs in a
 * `node` environment with no DOM, so the persist/apply logic is exercised as
 * plain, injectable-target functions (loadHighContrastPreference/
 * persistHighContrastPreference/applyHighContrast) rather than rendering the
 * thin React hook — testing the DOM-free core directly.
 *
 * See docs/TASK_21D_PWA_HARDENING_SPEC.md §5.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import {
  loadHighContrastPreference,
  persistHighContrastPreference,
  applyHighContrast,
} from "./useHighContrast.js";

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: vi.fn((key) => (key in store ? store[key] : null)),
    setItem: vi.fn((key, value) => { store[key] = value; }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    _store: store,
  };
}

function fakeRoot() {
  const attrs = {};
  return {
    setAttribute: vi.fn((name, value) => { attrs[name] = value; }),
    removeAttribute: vi.fn((name) => { delete attrs[name]; }),
    _attrs: attrs,
  };
}

describe("loadHighContrastPreference", () => {
  it("defaults to false when nothing is persisted", () => {
    const storage = fakeStorage();
    expect(loadHighContrastPreference(storage)).toBe(false);
  });

  it("returns true only when the stored value is exactly '1'", () => {
    expect(loadHighContrastPreference(fakeStorage({ aquadex_high_contrast: "1" }))).toBe(true);
    expect(loadHighContrastPreference(fakeStorage({ aquadex_high_contrast: "0" }))).toBe(false);
    expect(loadHighContrastPreference(fakeStorage({ aquadex_high_contrast: "true" }))).toBe(false);
  });

  it("defaults to false (never throws) when storage is unavailable", () => {
    expect(loadHighContrastPreference(null)).toBe(false);
    expect(() => loadHighContrastPreference(undefined)).not.toThrow();
  });

  it("defaults to false when the storage read itself throws", () => {
    const throwing = { getItem: () => { throw new Error("blocked"); } };
    expect(loadHighContrastPreference(throwing)).toBe(false);
  });
});

describe("persistHighContrastPreference", () => {
  it("persists '1' for true and '0' for false", () => {
    const storage = fakeStorage();
    persistHighContrastPreference(true, storage);
    expect(storage.setItem).toHaveBeenCalledWith("aquadex_high_contrast", "1");
    persistHighContrastPreference(false, storage);
    expect(storage.setItem).toHaveBeenCalledWith("aquadex_high_contrast", "0");
  });

  it("degrades gracefully (never throws) when storage is unavailable or errors", () => {
    expect(() => persistHighContrastPreference(true, null)).not.toThrow();
    const throwing = { setItem: () => { throw new Error("quota"); } };
    expect(() => persistHighContrastPreference(true, throwing)).not.toThrow();
  });
});

describe("applyHighContrast", () => {
  it("sets data-contrast=high on the root when enabled", () => {
    const root = fakeRoot();
    applyHighContrast(true, root);
    expect(root.setAttribute).toHaveBeenCalledWith("data-contrast", "high");
    expect(root.removeAttribute).not.toHaveBeenCalled();
  });

  it("removes the attribute when disabled", () => {
    const root = fakeRoot();
    applyHighContrast(false, root);
    expect(root.removeAttribute).toHaveBeenCalledWith("data-contrast");
    expect(root.setAttribute).not.toHaveBeenCalled();
  });

  it("never throws when no target is available", () => {
    expect(() => applyHighContrast(true, null)).not.toThrow();
  });
});

// ─── Root-level application path (source-guard) ─────────────────────────────

describe("App.jsx — applies high contrast app-wide on load (root-level call, not settings-panel-scoped)", () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL("../App.jsx", import.meta.url)),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("imports and calls useHighContrast at the App component root, alongside useFontSettings", () => {
    expect(SOURCE).toContain('import { useHighContrast } from "./hooks/useHighContrast";');
    expect(SOURCE).toContain("useHighContrast();");
  });

  // Settings Phase 3 (docs/SETTINGS_SPEC.md §5) split the old inline
  // FontSizeSettings/HighContrastToggle pair out of App.jsx's "settings" case
  // and into SettingsPanel -> AccessibilitySection, behind the SettingsSection
  // primitive. App.jsx's own useHighContrast() call above still applies the
  // preference app-wide on every load; AccessibilitySection binds its own
  // independent useHighContrast() to render the actual toggle.
  it("mounts HighContrastToggle inside the Settings panel's Accessibility section, not directly in App.jsx", () => {
    expect(SOURCE).not.toContain('import { HighContrastToggle } from "./components/HighContrastToggle";');

    const accessibilitySource = readFileSync(
      fileURLToPath(new URL("../components/settings/sections/AccessibilitySection.jsx", import.meta.url)),
      "utf8"
    );
    expect(accessibilitySource).toContain('import { HighContrastToggle } from "../../HighContrastToggle";');
    expect(accessibilitySource).toContain("<HighContrastToggle enabled={highContrast.enabled} onToggle={highContrast.toggle} />");
  });
});

describe("HighContrastToggle — keyboard-operable and labeled (§5 source-guard)", () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL("../components/HighContrastToggle.jsx", import.meta.url)),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("renders a real <button> (native keyboard operability), not a div/span with a click handler", () => {
    expect(SOURCE).toContain('<button');
    expect(SOURCE).toContain('type="button"');
  });

  it("carries role=switch + aria-checked + aria-label (not icon-only, not unlabeled)", () => {
    expect(SOURCE).toContain('role="switch"');
    expect(SOURCE).toContain("aria-checked={enabled}");
    expect(SOURCE).toContain('aria-label="High contrast mode"');
  });

  it("announces the new state on toggle (perceivable to screen readers, not just a visual change)", () => {
    expect(SOURCE).toContain('import { announce } from "../utils/a11y";');
    expect(SOURCE).toContain("announce(enabled ?");
  });
});
