/**
 * Unit tests for the PoseidonNarrator persona-aware copy resolution.
 *
 * The narrator component itself is timer/DOM driven (no jsdom in this project),
 * so these tests focus on the pure `resolveLine` helper and the integrity of the
 * ported DIALOGUE script — the logic that decides which line Poseidon speaks.
 */
import { describe, it, expect } from "vitest";

import { resolveLine, DIALOGUE } from "./PoseidonNarrator.jsx";

describe("resolveLine", () => {
  const entry = { casual: "Hello friend.", pro: "Operator acknowledged." };

  it("returns persona-neutral strings unchanged", () => {
    expect(resolveLine("Go on, give it a tap.", "casual")).toBe(
      "Go on, give it a tap."
    );
    expect(resolveLine(DIALOGUE.echoNudge, "pro")).toBe(DIALOGUE.echoNudge);
  });

  it("selects the casual line for the casual persona", () => {
    expect(resolveLine(entry, "casual")).toBe("Hello friend.");
  });

  it("selects the pro line for the pro persona", () => {
    expect(resolveLine(entry, "pro")).toBe("Operator acknowledged.");
  });

  it("accepts the legacy casualMode boolean (true ⇒ casual, false ⇒ pro)", () => {
    expect(resolveLine(entry, true)).toBe("Hello friend.");
    expect(resolveLine(entry, false)).toBe("Operator acknowledged.");
  });

  it("defaults to casual when persona is unknown or missing", () => {
    expect(resolveLine(entry, null)).toBe("Hello friend.");
    expect(resolveLine(entry, "banana")).toBe("Hello friend.");
    expect(resolveLine(entry, undefined)).toBe("Hello friend.");
  });

  it("falls back to the other tone when the requested one is absent", () => {
    expect(resolveLine({ pro: "Only pro." }, "casual")).toBe("Only pro.");
    expect(resolveLine({ casual: "Only casual." }, "pro")).toBe("Only casual.");
  });

  it("returns an empty string for null/undefined entries", () => {
    expect(resolveLine(null, "casual")).toBe("");
    expect(resolveLine(undefined, "pro")).toBe("");
  });
});

describe("DIALOGUE script integrity", () => {
  it("exposes the persona-aware entries with both casual and pro tones", () => {
    const personaKeys = [
      "personaConfirm",
      "walletPending",
      "walletSuccess",
      "namePrompt",
      "echoIntro",
      "echoTapped",
      "tankSetupIntro",
      "tankComplete",
    ];
    for (const key of personaKeys) {
      expect(typeof DIALOGUE[key].casual).toBe("string");
      expect(DIALOGUE[key].casual.length).toBeGreaterThan(0);
      expect(typeof DIALOGUE[key].pro).toBe("string");
      expect(DIALOGUE[key].pro.length).toBeGreaterThan(0);
    }
  });

  it("keeps persona-neutral entries as plain strings", () => {
    expect(typeof DIALOGUE.welcome).toBe("string");
    expect(typeof DIALOGUE.echoNudge).toBe("string");
    expect(typeof DIALOGUE.catalogSyncing).toBe("string");
  });
});
