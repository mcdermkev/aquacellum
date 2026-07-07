/**
 * Component tests for the name-confirmation step (onboarding-revamp task 6.3).
 *
 * This project's vitest runs in a `node` environment (no jsdom / testing-library),
 * and `NameConfirmStep.jsx` transitively imports Dexie / Supabase / generateAlias
 * via React context. The user-facing behaviour the task asks us to verify is
 * driven by pure helpers extracted into `nameConfirmCopy.js` plus the
 * deterministic alias source, so we exercise those directly:
 *   - Name validation: confirm disabled when empty, capped at 30 chars (Req 7.6).
 *   - Enter-submits: the same `isNameValid` gate governs the Enter handler, and a
 *     static guard confirms the component wires Enter → submit and disables the
 *     button while invalid (Req 7.6).
 *   - Alias prefill: the field is seeded from `generateAlias(account)` (Req 7.1).
 *
 * Validates: Requirements 7.1, 7.6
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import {
  MAX_NAME_LENGTH,
  normalizeName,
  cleanName,
  isNameValid,
  nameConfirmButtonLabel,
} from "./nameConfirmCopy.js";
import { generateAlias } from "../../utils/generateAlias.js";

const NAME_STEP_SOURCE = readFileSync(
  fileURLToPath(new URL("./NameConfirmStep.jsx", import.meta.url)),
  "utf8"
);

describe("Name validation — confirm disabled when empty (Req 7.6)", () => {
  it("treats empty and whitespace-only names as invalid", () => {
    expect(isNameValid("")).toBe(false);
    expect(isNameValid("   ")).toBe(false);
    expect(isNameValid(null)).toBe(false);
    expect(isNameValid(undefined)).toBe(false);
  });

  it("treats a non-empty trimmed name as valid", () => {
    expect(isNameValid("Coral")).toBe(true);
    expect(isNameValid("  Reef Keeper  ")).toBe(true);
  });

  it("disables the confirm button (invalid) for empty input, enables it otherwise", () => {
    // The component binds `disabled={!valid || busy}` where `valid = isNameValid(value)`.
    const disabledWhenEmpty = !isNameValid("") || false;
    const disabledWhenNamed = !isNameValid("Nemo") || false;
    expect(disabledWhenEmpty).toBe(true);
    expect(disabledWhenNamed).toBe(false);
  });
});

describe("Name validation — max 30 chars (Req 7.6)", () => {
  it("caps the suggested limit at 30", () => {
    expect(MAX_NAME_LENGTH).toBe(30);
  });

  it("clamps typed input to 30 characters", () => {
    const long = "x".repeat(50);
    expect(normalizeName(long)).toHaveLength(30);
    expect(normalizeName(long)).toBe("x".repeat(30));
  });

  it("preserves names at or under the limit", () => {
    expect(normalizeName("Coral-Tetra-4821")).toBe("Coral-Tetra-4821");
    expect(cleanName("  Reef Keeper  ")).toBe("Reef Keeper");
  });

  it("enforces the maxLength cap in the rendered input", () => {
    expect(NAME_STEP_SOURCE).toMatch(/maxLength=\{MAX_NAME_LENGTH\}/);
  });
});

describe("Enter submits the name (Req 7.6)", () => {
  it("only submits on Enter when the name is valid", () => {
    // The handler gate is `e.key === "Enter" && isNameValid(value) && !busy`.
    const canSubmit = (key, value, busy) =>
      key === "Enter" && isNameValid(value) && !busy;

    expect(canSubmit("Enter", "Nemo", false)).toBe(true);
    expect(canSubmit("Enter", "", false)).toBe(false);
    expect(canSubmit("Enter", "Nemo", true)).toBe(false);
    expect(canSubmit("a", "Nemo", false)).toBe(false);
  });

  it("wires the Enter key to the confirm handler", () => {
    expect(NAME_STEP_SOURCE).toContain("onKeyDown={handleKeyDown}");
    expect(NAME_STEP_SOURCE).toMatch(/e\.key === "Enter"/);
    expect(NAME_STEP_SOURCE).toMatch(/handleConfirm\(\)/);
  });

  it("disables confirm while the name is invalid or busy", () => {
    expect(NAME_STEP_SOURCE).toMatch(/disabled=\{!valid \|\| busy\}/);
  });
});

describe("Random handle — opt-in, lowercase (Req 7.1)", () => {
  const account = "0x1234567890ABCDEF1234567890abcdef12345678";

  it("derives a deterministic, non-empty alias from the account", () => {
    const alias = generateAlias(account);
    expect(alias).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
    expect(generateAlias(account)).toBe(alias); // deterministic
  });

  it("always produces a lowercase alias (no casing introduced by us)", () => {
    const alias = generateAlias(account);
    expect(alias).toBe(alias.toLowerCase());
    // Same address in different casing yields the same lowercase handle.
    expect(generateAlias(account.toLowerCase())).toBe(alias);
    expect(generateAlias(account.toUpperCase().replace("0X", "0x"))).toBe(alias);
  });

  it("produces a handle within the 30-char field limit", () => {
    const seed = normalizeName(generateAlias(account));
    expect(seed).toBe(generateAlias(account));
    expect(seed.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(isNameValid(seed)).toBe(true);
  });

  it("does NOT auto-seed the field from the alias — new users start empty", () => {
    // The field seeds only from a resumed-session displayName, never the alias.
    expect(NAME_STEP_SOURCE).toMatch(/normalizeName\(displayName \|\| ""\)/);
    expect(NAME_STEP_SOURCE).not.toMatch(
      /normalizeName\(displayName \|\| suggestedAlias\)/
    );
  });

  it("exposes the alias only through the opt-in random-handle control", () => {
    // suggestedAlias is still derived from the account, but applied on demand
    // via the handleUseRandom handler wired to the opt-in button.
    expect(NAME_STEP_SOURCE).toContain("generateAlias(account)");
    expect(NAME_STEP_SOURCE).toContain("handleUseRandom");
    expect(NAME_STEP_SOURCE).toMatch(/setValue\(normalizeName\(suggestedAlias\)\)/);
  });
});

describe("Confirm button label", () => {
  it("shows the persona-aware confirm label and a busy label", () => {
    expect(nameConfirmButtonLabel(true, false)).toBe("That's Me");
    expect(nameConfirmButtonLabel(false, false)).toBe("Confirm Callsign");
    expect(nameConfirmButtonLabel(true, true)).toBe("Saving…");
  });
});
