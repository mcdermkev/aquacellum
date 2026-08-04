/**
 * Unit tests for useAiPrefs.js and the Echo gating it feeds (Settings Phase 2a,
 * docs/SETTINGS_SPEC.md D-S-4 / D-S-5).
 *
 * This repo's vitest runs in a `node` environment with no DOM, so the storage
 * logic is exercised as plain injectable-storage functions rather than by
 * rendering the hook — the useHighContrast.test.js precedent.
 *
 * The second describe block is the part that matters most. `aquadex_echo_enabled`
 * shipped as a toggle that was written and read NOWHERE while the copy claimed it
 * hid the companion. Unit-testing the hook alone would not have caught that, because
 * the hook was never the broken part — the missing consumer was. So these are
 * source-level assertions that every Echo surface in App.jsx is actually gated,
 * which is the specific regression that produced the finding.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import {
  AI_PREF_KEYS,
  AI_PREFS_CHANGED_EVENT,
  isAiFeatureEnabled,
  loadAiPrefs,
  persistAiPref,
} from "./useAiPrefs.js";

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: vi.fn((key) => (key in store ? store[key] : null)),
    setItem: vi.fn((key, value) => { store[key] = value; }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    _store: store,
  };
}

function throwingStorage() {
  return {
    getItem: vi.fn(() => { throw new Error("SecurityError"); }),
    setItem: vi.fn(() => { throw new Error("QuotaExceededError"); }),
  };
}

function readSource(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

describe("isAiFeatureEnabled", () => {
  it("defaults to enabled when nothing is persisted", () => {
    const storage = fakeStorage();
    expect(isAiFeatureEnabled("poseidon", storage)).toBe(true);
    expect(isAiFeatureEnabled("echo", storage)).toBe(true);
  });

  it("treats only the exact string \"false\" as disabled", () => {
    // Preserves the `getItem(key) !== "false"` semantics used by the 6 existing
    // Poseidon call sites. Changing this silently re-enables everyone who opted out.
    expect(isAiFeatureEnabled("echo", fakeStorage({ [AI_PREF_KEYS.echo]: "false" }))).toBe(false);
    expect(isAiFeatureEnabled("echo", fakeStorage({ [AI_PREF_KEYS.echo]: "true" }))).toBe(true);
    expect(isAiFeatureEnabled("echo", fakeStorage({ [AI_PREF_KEYS.echo]: "0" }))).toBe(true);
    expect(isAiFeatureEnabled("echo", fakeStorage({ [AI_PREF_KEYS.echo]: "" }))).toBe(true);
  });

  it("defaults to enabled when storage throws", () => {
    // An unreadable preference must never silently disable a companion the user
    // never turned off.
    expect(isAiFeatureEnabled("poseidon", throwingStorage())).toBe(true);
  });

  it("defaults to enabled for an unknown feature name and for absent storage", () => {
    expect(isAiFeatureEnabled("nope", fakeStorage())).toBe(true);
    expect(isAiFeatureEnabled("echo", null)).toBe(true);
  });

  it("reads the two features independently", () => {
    const storage = fakeStorage({ [AI_PREF_KEYS.echo]: "false" });
    expect(loadAiPrefs(storage)).toEqual({ poseidonEnabled: true, echoEnabled: false });
  });
});

describe("persistAiPref", () => {
  it("writes the string form the readers expect", () => {
    const storage = fakeStorage();
    persistAiPref("echo", false, storage);
    expect(storage._store[AI_PREF_KEYS.echo]).toBe("false");
    persistAiPref("echo", true, storage);
    expect(storage._store[AI_PREF_KEYS.echo]).toBe("true");
  });

  it("round-trips through isAiFeatureEnabled", () => {
    const storage = fakeStorage();
    persistAiPref("poseidon", false, storage);
    expect(isAiFeatureEnabled("poseidon", storage)).toBe(false);
  });

  it("does not throw when storage is unavailable or rejects the write", () => {
    expect(() => persistAiPref("echo", false, null)).not.toThrow();
    expect(() => persistAiPref("echo", false, throwingStorage())).not.toThrow();
  });

  it("ignores an unknown feature rather than writing a junk key", () => {
    const storage = fakeStorage();
    persistAiPref("nope", false, storage);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe("the Echo toggle has readers (D-S-4)", () => {
  const appSource = readSource("../App.jsx");

  // Every Echo surface rendered in App.jsx. If a new one is added, add it here —
  // that is the point: the list is the contract.
  const ECHO_SURFACES = [
    "<EchoCompanionWidget",
    "<EchoWhispers",
    "<EchoAmbient",
    "<EchoLivingCompanion",
    "<EchoRareMomentOverlay",
  ];

  it("reads the preference through useAiPrefs, not inline localStorage", () => {
    expect(appSource).toMatch(/useAiPrefs\(\)/);
    expect(appSource).not.toMatch(/localStorage\.getItem\(["']aquadex_echo_enabled["']\)/);
  });

  it.each(ECHO_SURFACES)("gates %s on echoEnabled", (tag) => {
    const lines = appSource.split("\n");
    const index = lines.findIndex((line) => line.includes(tag));
    expect(index, `${tag} not found in App.jsx`).toBeGreaterThan(-1);

    // The JSX tag and its enclosing condition sit within a few lines of each other.
    const window = lines.slice(Math.max(0, index - 4), index + 1).join("\n");
    expect(window, `${tag} is rendered without an echoEnabled guard`).toContain("echoEnabled");
  });

  it("gates the rare-moment CHECK, not just the overlay", () => {
    // performCheck() calls recordRareMoment(), which permanently consumes the
    // moment. Gating only the overlay would spend rare moments the user is never
    // shown, so the flag has to reach the hook.
    expect(appSource).toMatch(/useEchoRareMoments\(\s*echoState\s*,\s*echoEnabled\s*\)/);

    const hookSource = readSource("./useEchoRareMoments.js");
    expect(hookSource).toMatch(/export function useEchoRareMoments\(echoState, enabled = true\)/);
    expect(hookSource).toMatch(/const active = !!enabled && !!echoState\?\.hasEcho/);
  });

  it("suppresses presence without resetting state", () => {
    // Off means quiet, not reset: useEchoState keeps running so needs stay
    // replenished by XP events and the companion returns as the user left it.
    expect(appSource).toMatch(/useEchoState\(account\)/);
    expect(appSource).not.toMatch(/echoEnabled\s*&&\s*useEchoState/);
  });
});

describe("the Settings toggles are backed by the hook (D-S-5)", () => {
  // Phase 3 (docs/SETTINGS_SPEC.md §5) split the old DataPortabilityWidget.jsx
  // by concern; the AI Companions toggles now live in CompanionsSection.jsx and
  // the hook itself is owned one level up in SettingsPanel.jsx.
  const panelSource = readSource("../components/settings/SettingsPanel.jsx");
  const companionsSource = readSource("../components/settings/sections/CompanionsSection.jsx");
  const modeSource = readSource("../components/settings/sections/ExperienceModeSection.jsx");

  it("no longer reads localStorage inline during render", () => {
    // The old toggles read localStorage in the `checked` prop, so a write never
    // re-rendered and the thumb could look stuck.
    expect(companionsSource).not.toMatch(/localStorage\.getItem\(["']aquadex_(poseidon|echo)_enabled["']\)/);
    expect(panelSource).toMatch(/useAiPrefs\(\)/);
  });

  it("stops hand-dispatching the change event", () => {
    // Broadcasting is the hook's job now, so there is one place that does it.
    expect(companionsSource).not.toContain(`new CustomEvent("${AI_PREFS_CHANGED_EVENT}")`);
    expect(panelSource).not.toContain(`new CustomEvent("${AI_PREFS_CHANGED_EVENT}")`);
  });

  it("no longer gates the mode switch behind a confirmation step (D-S-2)", () => {
    expect(modeSource).not.toContain("showModeConfirm");
    expect(modeSource).toContain("<ModeSegmentedControl");
  });
});
