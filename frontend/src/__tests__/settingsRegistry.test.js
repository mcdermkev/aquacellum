/**
 * settingsRegistry.test.js — AC-3, "the honesty test"
 * (docs/SETTINGS_SPEC.md §7).
 *
 * For every entry in `components/settings/settingsRegistry.js`, at least one
 * of its declared `readBy` modules must actually reference the storage key
 * (or, when `readerPattern` is given, match that pattern). This is a
 * source-level check rather than a behavioral one deliberately: the defect
 * this AC exists to catch — `aquadex_echo_enabled` written and read
 * *nowhere* while the copy claimed it worked — was never a logic bug in any
 * one function. It was the *absence* of a consumer, which only a check like
 * "does anything outside Settings mention this key at all" can catch.
 *
 * Every reader path is also required to live outside `components/settings/`
 * — a control cannot satisfy this test by reading its own write back.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { SETTINGS_REGISTRY } from "../components/settings/settingsRegistry.js";

const SRC_ROOT = new URL("../", import.meta.url);

function readSource(relativePath) {
  const url = new URL(relativePath, SRC_ROOT);
  return readFileSync(fileURLToPath(url), "utf8");
}

describe("SETTINGS_REGISTRY entries", () => {
  it.each(SETTINGS_REGISTRY)(
    "$key ($control) has at least one real reader outside components/settings/",
    ({ key, readBy, readerPattern }) => {
      expect(Array.isArray(readBy) && readBy.length > 0, `${key} declares no readBy paths`).toBe(true);

      for (const path of readBy) {
        expect(
          path.startsWith("components/settings/"),
          `${key}'s readBy path "${path}" must live outside components/settings/ — a control cannot read its own write back as proof it's wired`
        ).toBe(false);
      }

      const pattern = readerPattern ? new RegExp(readerPattern, "m") : null;

      const matchedIn = readBy.filter((path) => {
        let source;
        try {
          source = readSource(path);
        } catch {
          return false;
        }
        return pattern ? pattern.test(source) : source.includes(key);
      });

      expect(
        matchedIn.length,
        `${key} (${readBy.join(", ")}) has no reader that actually references it — this is the dead-control defect AC-3 exists to catch`
      ).toBeGreaterThan(0);
    }
  );

  it("declares every key exactly once", () => {
    const keys = SETTINGS_REGISTRY.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
