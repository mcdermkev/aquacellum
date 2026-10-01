/**
 * Guard for the Settings Daylight rework (SettingsDaylight.css, st-* classes).
 *
 * Source-level, like the other Settings tests, because this repo's vitest runs
 * without a DOM. Two kinds of assertion:
 *
 *   1. COPY AND MARKUP RULES that are easy to undo by accident: no emoji or
 *      symbol glyphs standing in for icons (Phosphor icons are used instead), no
 *      em dashes or exclamation points in visible text, no bare `.btn` class.
 *   2. BEHAVIOUR THE RESTYLE MUST NOT TOUCH: the switch and radio semantics, the
 *      heading/collapse wiring, the account-deletion and device-clear gates, and
 *      the Settings -> Fish Finder saved-search hand-off.
 *
 * Comments are stripped first: several docblocks quote the old copy to explain
 * why it changed.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const SRC = new URL("../", import.meta.url);

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, SRC)), "utf8");
}

function readCode(relativePath) {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Every file the rework restyled. CompanionsSection and AiCompanionToggle are
// owned by the companion work and deliberately not covered here.
const COVERED = [
  "components/settings/SettingsPanel.jsx",
  "components/settings/SettingsSection.jsx",
  "components/settings/SettingsToggle.jsx",
  "components/settings/SettingsRadioGroup.jsx",
  "components/settings/SettingsSubsectionLabel.jsx",
  "components/settings/ReducedMotionOverride.jsx",
  "components/settings/InstallAppPanel.jsx",
  "components/settings/VacationModeControl.jsx",
  "components/settings/sections/ExperienceModeSection.jsx",
  "components/settings/sections/AccountSection.jsx",
  "components/settings/sections/NotificationsSection.jsx",
  "components/settings/sections/AccessibilitySection.jsx",
  "components/settings/sections/UnitsSection.jsx",
  "components/settings/sections/AquariumsSection.jsx",
  "components/settings/sections/DiscoverySection.jsx",
  "components/settings/sections/SellerSection.jsx",
  "components/settings/sections/ZoneSection.jsx",
  "components/settings/sections/BackupSection.jsx",
  "components/settings/sections/AppSupportSection.jsx",
  "components/settings/sections/SmartWalletSection.jsx",
  "components/settings/sections/ResetSection.jsx",
  "components/settings/sections/PrivacySection.jsx",
  "components/reef/SonarPreferences.jsx",
  "components/reef/DataPrivacySettings.jsx",
  "components/FontSizeSettings.jsx",
  "components/HighContrastToggle.jsx",
  "components/ZoneAssignmentFlow.jsx",
];

const BANNED_GLYPHS = ["✓", "✕", "↗", "→", "▾", "⚠", "ℹ", "⬆"];

describe("Settings Daylight shell", () => {
  it("loads its own stylesheet and renders the .st root", () => {
    const panel = readCode("components/settings/SettingsPanel.jsx");
    expect(panel).toContain('import "./SettingsDaylight.css";');
    expect(panel).toContain('className="st"');
  });

  it("uses the st- prefix in its stylesheet", () => {
    const css = read("components/settings/SettingsDaylight.css");
    expect(css).toMatch(/^\.st,/m);
    expect(css).toMatch(/\.st-section\s*\{/);
    expect(css).toContain("color-scheme: light");
  });
});

describe("plain copy and icons in every restyled file", () => {
  it.each(COVERED)("%s has no emoji or symbol glyphs standing in for icons", (file) => {
    const code = readCode(file);
    const pictographs = code.match(/\p{Extended_Pictographic}/gu) || [];
    expect(pictographs, `${file} contains ${pictographs.join(" ")}`).toEqual([]);
    for (const glyph of BANNED_GLYPHS) {
      expect(code.includes(glyph), `${file} contains ${glyph}`).toBe(false);
    }
  });

  it.each(COVERED)("%s has no em dash in code or visible text", (file) => {
    // A lone "—" literal is the empty-value placeholder in read-only rows, which
    // is a symbol, not prose.
    const code = readCode(file).replace(/"—"/g, "");
    expect(code.includes("—"), `${file} contains an em dash`).toBe(false);
  });

  it.each(COVERED)("%s has no exclamation point ending visible text", (file) => {
    expect(readCode(file)).not.toMatch(/[A-Za-z]!(?=["'`\s<])/);
  });

  it.each(COVERED)("%s uses no bare .btn class", (file) => {
    expect(readCode(file)).not.toContain('className="btn"');
  });
});

describe("control semantics survive the restyle", () => {
  it("keeps both switches as role=switch buttons with aria-checked", () => {
    for (const file of ["components/settings/SettingsToggle.jsx", "components/HighContrastToggle.jsx"]) {
      const code = readCode(file);
      expect(code, file).toContain('role="switch"');
      expect(code, file).toContain("aria-checked={enabled}");
      expect(code, file).toContain('type="button"');
    }
  });

  it("keeps the radio group a labelled radiogroup with arrow-key movement", () => {
    const code = readCode("components/settings/SettingsRadioGroup.jsx");
    expect(code).toContain('role="radiogroup"');
    expect(code).toContain('role="radio"');
    expect(code).toContain("aria-label={label}");
    expect(code).toContain("tabIndex=");
    expect(code).toContain("onKeyDown=");
    expect(code).toContain("nextRadioIndex");
  });

  it("gives the tank list and font sizes the same keyboard pattern", () => {
    for (const file of ["components/settings/sections/AquariumsSection.jsx", "components/FontSizeSettings.jsx"]) {
      const code = readCode(file);
      expect(code, file).toContain('role="radio"');
      expect(code, file).toContain("nextRadioIndex");
      expect(code, file).toContain("tabIndex");
    }
  });

  it("moves the font-size Tab stop with focus, since arrows there only preview", () => {
    const code = readCode("components/FontSizeSettings.jsx");
    expect(code).toContain("const tabStop = focusedIndex ?? (currentIndex >= 0 ? currentIndex : 0);");
    expect(code).toContain("onFocus={handleGroupFocus}");
    expect(code).toContain("onBlur={handleGroupBlur}");
    expect(code).toContain("event.currentTarget.contains(event.relatedTarget)");
  });

  it("keeps a selected choice's description at AA contrast on the teal tint", () => {
    const css = read("components/settings/SettingsDaylight.css");
    expect(css).toMatch(
      /\.st-choice\[aria-checked="true"\] \.st-choice-desc\s*\{\s*color:\s*var\(--text-secondary\);/
    );
  });

  it("uses only callout modifiers the stylesheet defines", () => {
    const css = read("components/settings/SettingsDaylight.css");
    for (const file of COVERED) {
      const used = readCode(file).match(/st-callout--[a-z-]+/g) || [];
      for (const modifier of used) {
        expect(css.includes(`.${modifier}`), `${file} uses undefined ${modifier}`).toBe(true);
      }
    }
  });

  it("nests the collapse button inside the section heading", () => {
    const code = readCode("components/settings/SettingsSection.jsx");
    const h3At = code.indexOf("<h3");
    const buttonAt = code.indexOf("<button");
    expect(h3At).toBeGreaterThan(-1);
    expect(buttonAt).toBeGreaterThan(h3At);
    expect(code).toContain("aria-expanded={!collapsed}");
    expect(code).toContain("aria-controls={bodyId}");
    expect(code).toContain("data-settings-section={id}");
    expect(code).toContain("aria-labelledby={headingId}");
  });

  it("ties the display-name input to a visible label", () => {
    const code = readCode("components/settings/sections/AccountSection.jsx");
    expect(code).toContain('htmlFor="st-display-name"');
    expect(code).toContain('id="st-display-name"');
  });

  it("keeps the restore file input reachable by keyboard", () => {
    const code = readCode("components/settings/sections/BackupSection.jsx");
    expect(code).not.toMatch(/display:\s*["']none["']/);
    expect(code).toContain('className="st-sr-only"');
  });
});

describe("destructive paths keep their gates", () => {
  it("account deletion still needs the typed phrase and keeps its cancel path", () => {
    const code = readCode("components/reef/DataPrivacySettings.jsx");
    expect(code).toContain("const confirmed = confirmText === DELETION_CONFIRM_PHRASE;");
    expect(code).toContain("disabled={deleting || !confirmed}");
    expect(code).toContain("requestAccountDeletion(confirmText)");
    expect(code).toContain("cancelAccountDeletion()");
    expect(code).toContain('role="alert"');
    expect(code).toContain('htmlFor="delete-account-confirm"');
    expect(code).toContain('id="delete-account-confirm"');
  });

  it("clearing the device still takes two clicks", () => {
    const code = readCode("components/settings/sections/ResetSection.jsx");
    expect(code).toContain("setShowConfirm(true)");
    expect(code).toContain("onClick={handleReset}");
    expect(code).toContain("{!showConfirm ? (");
  });
});

describe("the Fish Finder saved-search hand-off is unchanged", () => {
  it("still dispatches aquadex:navigate-tab to the directory with the saved search", () => {
    const code = readCode("components/settings/sections/DiscoverySection.jsx");
    expect(code).toContain('new CustomEvent("aquadex:navigate-tab", {');
    expect(code).toContain('detail: { tab: "directory", savedSearch: entry },');
    expect(code).toContain("onClick={() => runSavedSearch(entry)}");
  });
});
