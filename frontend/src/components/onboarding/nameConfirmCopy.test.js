/**
 * Unit tests for the NameConfirmStep pure copy + validation helpers.
 *
 * This project's vitest runs in a `node` environment (no jsdom), and the
 * component module imports React contexts / Dexie that touch `window` at load
 * time, so these tests target the side-effect-free helper module
 * (`nameConfirmCopy.js`) — the persona-aware wording plus the name
 * normalization / clamping / validation logic.
 *
 * Render-based assertions (alias prefill, Enter-to-submit, disabled-when-empty
 * in the live component) are covered by task 6.3.
 *
 * Validates: Requirements 7.1, 7.2, 7.6
 */
import { describe, it, expect } from "vitest";

import {
  NAME_CONFIRM_COPY,
  MAX_NAME_LENGTH,
  resolvePersonaCopy,
  nameConfirmButtonLabel,
  normalizeName,
  cleanName,
  isNameValid,
} from "./nameConfirmCopy.js";

describe("MAX_NAME_LENGTH", () => {
  it("caps display names at 30 characters (Req 7.6)", () => {
    expect(MAX_NAME_LENGTH).toBe(30);
  });
});

describe("normalizeName — clamp-while-typing (Req 7.6)", () => {
  it("truncates input to MAX_NAME_LENGTH characters", () => {
    const long = "a".repeat(50);
    expect(normalizeName(long)).toHaveLength(MAX_NAME_LENGTH);
  });

  it("leaves a name within the limit unchanged, preserving interior spaces", () => {
    expect(normalizeName("Coral Tetra")).toBe("Coral Tetra");
  });

  it("preserves leading/trailing whitespace while typing (trimmed only at submit)", () => {
    expect(normalizeName("  Reef ")).toBe("  Reef ");
  });

  it("normalizes null/undefined/empty to an empty string", () => {
    expect(normalizeName(null)).toBe("");
    expect(normalizeName(undefined)).toBe("");
    expect(normalizeName("")).toBe("");
  });

  it("coerces non-string input via String() before clamping", () => {
    expect(normalizeName(12345)).toBe("12345");
  });
});

describe("cleanName — the value actually persisted (Req 7.2)", () => {
  it("trims surrounding whitespace", () => {
    expect(cleanName("  Coral-Tetra-4821  ")).toBe("Coral-Tetra-4821");
  });

  it("clamps then trims a whitespace-padded over-length name to <= 30 chars", () => {
    const result = cleanName(`  ${"x".repeat(40)}  `);
    expect(result.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(cleanName("    ")).toBe("");
  });
});

describe("isNameValid — confirm disabled when empty (Req 7.6)", () => {
  it("is false for empty / whitespace-only / nullish names", () => {
    expect(isNameValid("")).toBe(false);
    expect(isNameValid("   ")).toBe(false);
    expect(isNameValid(null)).toBe(false);
    expect(isNameValid(undefined)).toBe(false);
  });

  it("is true for a non-empty name", () => {
    expect(isNameValid("Echo")).toBe(true);
    expect(isNameValid("  Echo  ")).toBe(true);
  });
});

describe("resolvePersonaCopy — persona-aware wording", () => {
  it("returns casual copy for casualMode true / 'casual'", () => {
    expect(resolvePersonaCopy(NAME_CONFIRM_COPY.button, true)).toBe("That's Me");
    expect(resolvePersonaCopy(NAME_CONFIRM_COPY.button, "casual")).toBe("That's Me");
  });

  it("returns pro copy for casualMode false / 'pro'", () => {
    expect(resolvePersonaCopy(NAME_CONFIRM_COPY.button, false)).toBe("Confirm Callsign");
    expect(resolvePersonaCopy(NAME_CONFIRM_COPY.button, "pro")).toBe("Confirm Callsign");
  });

  it("defaults to the casual tone when persona is unset (null/undefined)", () => {
    expect(resolvePersonaCopy(NAME_CONFIRM_COPY.button, null)).toBe("That's Me");
    expect(resolvePersonaCopy(NAME_CONFIRM_COPY.button, undefined)).toBe("That's Me");
  });

  it("returns an empty string for a missing entry", () => {
    expect(resolvePersonaCopy(undefined, true)).toBe("");
  });
});

describe("nameConfirmButtonLabel — state-aware CTA label", () => {
  it("shows the confirm label when idle", () => {
    expect(nameConfirmButtonLabel(true, false)).toBe("That's Me");
    expect(nameConfirmButtonLabel(false, false)).toBe("Confirm Callsign");
  });

  it("shows the busy label while persistence is in-flight", () => {
    expect(nameConfirmButtonLabel(true, true)).toBe("Saving…");
    expect(nameConfirmButtonLabel(false, true)).toBe("Registering…");
  });
});

describe("NAME_CONFIRM_COPY — completeness", () => {
  it("provides both casual and pro variants for every entry", () => {
    for (const key of Object.keys(NAME_CONFIRM_COPY)) {
      expect(NAME_CONFIRM_COPY[key]).toHaveProperty("casual");
      expect(NAME_CONFIRM_COPY[key]).toHaveProperty("pro");
    }
  });
});
