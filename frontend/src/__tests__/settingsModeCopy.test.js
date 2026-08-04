/**
 * The casual/pro copy contract for Settings (docs/SETTINGS_SPEC.md §3, AC-4, AC-6).
 *
 * THE RULE BEING PROTECTED: mode changes labels, copy register and density — never
 * whether a control exists. Casual/pro is a self-service display preference
 * (`entitlements.js`), not an entitlement, so a section may be re-worded for a mode
 * but must never be withheld from one.
 *
 * The defects these assertions exist to catch, both real and both shipped once:
 *
 *   1. HALF-BRANCHED SECTIONS. "Data Management & Portability" was an unbranched
 *      pro-register heading sitting on top of branched plain-English body copy.
 *   2. UNBRANCHED JARGON. The Smart Wallet card had no mode branching at all, so
 *      casual users read "On-Chain Smart Wallet (EIP-4337)", "Base Sepolia" and
 *      "CDP Paymaster" while the Experience Mode card a few sections above promised
 *      casual mode keeps technical blockchain details tucked away (D-S-6).
 *
 * Source-level assertions, since this repo's vitest runs without a DOM.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const SETTINGS = new URL("../components/settings/", import.meta.url);

function readSettings(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, SETTINGS)), "utf8");
}

function sectionFiles() {
  const dir = fileURLToPath(new URL("sections/", SETTINGS));
  return readdirSync(dir).filter((name) => name.endsWith(".jsx"));
}

describe("mode never decides whether a control exists (AC-4)", () => {
  it("renders no section conditionally on casualModeActive", () => {
    // Hiding a section from a mode is the one thing the contract forbids outright.
    const panel = readSettings("SettingsPanel.jsx");
    expect(panel).not.toMatch(/casualModeActive\s*&&\s*</);
    expect(panel).not.toMatch(/casualModeActive\s*\?\s*</);
  });

  it("never combines casualModeActive with an entitlement check", () => {
    // A display preference and an earned capability are different axes. Mixing them
    // in one condition is how a mode toggle starts withholding a paid-for feature.
    for (const file of sectionFiles()) {
      const source = readSettings(`sections/${file}`);
      expect(source, file).not.toMatch(/casualModeActive[^\n]*hasEntitlement/);
      expect(source, file).not.toMatch(/hasEntitlement[^\n]*casualModeActive/);
    }
  });
});

describe("every copy pair is complete, never half-branched (AC-4)", () => {
  it("pairs each casual: with a pro:", () => {
    // A `{ casual }` with no `pro` resolves to undefined in pro mode — a section
    // with no heading. A plain string is the sanctioned way to say "deliberately
    // unbranched", so only the PAIRED form is counted here.
    const files = [...sectionFiles().map((f) => `sections/${f}`), "SettingsSection.jsx"];
    for (const file of files) {
      const source = readSettings(file);
      const casualCount = (source.match(/(?<!\w)casual:/g) || []).length;
      const proCount = (source.match(/(?<!\w)pro:/g) || []).length;
      expect(casualCount, `${file} has ${casualCount} casual: vs ${proCount} pro:`).toBe(proCount);
    }
  });
});

describe("D-S-6 — the Smart Wallet card has a casual face and is not hidden", () => {
  const source = readSettings("sections/SmartWalletSection.jsx");

  it("branches its title and description instead of showing one register to both", () => {
    expect(source).toMatch(/title=\{\{\s*casual:/);
    expect(source).toMatch(/description=\{\{/);
  });

  it("keeps the protocol jargon out of every casual-facing string", () => {
    // The jargon may still exist in the file — pro mode and the technical readout
    // both need it. What must not happen is any CASUAL string carrying it, so this
    // checks all of them rather than a single match (the first `casual:` is the
    // short title, which is not where the leak would hide).
    const casualStrings = [...source.matchAll(/(?<!\w)casual:\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(casualStrings.length).toBeGreaterThan(1);
    expect(casualStrings.some((text) => text.length > 40), "no substantive casual copy found").toBe(true);

    for (const text of casualStrings) {
      for (const term of ["EIP-4337", "Base Sepolia", "CDP Paymaster", "UserOperation", "BaseScan"]) {
        expect(text, `casual copy mentions ${term}`).not.toContain(term);
      }
    }
  });

  it("still gives casual users a route to the technical detail", () => {
    // Tucked away, not withheld — and via a native <details>, so it is keyboard
    // operable and announces its expanded state without custom handling (AC-5).
    expect(source).toMatch(/<details>/);
    expect(source).toMatch(/Show technical details/);
    expect(source).toMatch(/<summary/);
  });

  it("reports the same underlying status in both registers", () => {
    // The card's real job is saying whether records are actually being written, so
    // both modes must surface the failure state rather than casual getting silence.
    expect(source).toMatch(/statusLabel/);
    expect(source).toMatch(/Paused/);
    expect(source).toMatch(/Offline/);
  });
});

describe("stale copy stays gone (AC-6)", () => {
  it("has no retired product name", () => {
    for (const file of sectionFiles()) {
      expect(readSettings(`sections/${file}`), file).not.toMatch(/Aquacellum Tank Manager/);
    }
  });

  it("does not warn that switching mode hides tools", () => {
    // The old confirm gate overstated the consequence; casual hides exactly one tab.
    const experienceMode = readSettings("sections/ExperienceModeSection.jsx");
    expect(experienceMode).not.toMatch(/hide some advanced tools/);
    expect(experienceMode).toMatch(/Nothing is locked/);
  });
});
