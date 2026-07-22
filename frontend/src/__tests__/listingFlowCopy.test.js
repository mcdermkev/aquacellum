/**
 * Web2 language invariant for the Task 9 Increment 2 assisted-listing flow
 * copy (docs/TASK_09_INC2_LISTING_FLOW_SPEC.md §4 acceptance criterion 5):
 * every new seller-facing string (confidence pills, AI-draft notice, preset
 * copy, compatibility preview headline) must be free of PROHIBITED_TERMS,
 * matching the established invariant test style
 * (src/__tests__/orderCopy.test.js, addOnPresenter.test.js).
 *
 * These strings live inline in JSX (not a dedicated copy module), so this
 * test enumerates the literal new-UI strings directly rather than importing
 * a copy table — the equivalent of a snapshot-style guard against
 * accidentally introducing Web3 terminology into this surface.
 */
import { describe, it, expect } from "vitest";
import { containsProhibitedTerm } from "../services/orderCopy.js";

const LISTING_FLOW_STRINGS = [
  // Confidence pills (ListSpecimenModal.jsx ConfidencePill)
  "✓ verified",
  "≈ estimated",
  // Auto-populate hint
  "✨ Auto-filled from Spec-Dex care data",
  // Compatibility preview
  "Buyer view:",
  // Price suggestion
  "Similar listings suggest",
  "Use this price",
  // Poseidon draft control + notice
  "Draft with Poseidon",
  "Drafting…",
  "AI draft — review before publishing",
  "Use this draft",
  "Dismiss",
  // Packing profile preview
  "Packing profile",
  "Fits comfortably in one of this box size.",
  "Using a default box estimate — add a parcel preset in Shipping settings for an exact fit.",
  // ParcelPresetEditor.jsx
  "Parcel presets",
  "Your reusable insulated-box configurations. Each listing's packing profile is checked against one of these so you can see exactly how many bags and fish a box fits before you ship.",
  "Add a parcel preset",
  "This box fits ~",
  "Use as my default preset",
  // BreederTerminal.jsx ListingsSection status labels
  "Active",
  "Paused",
  "Sold out",
  "Sold",
];

describe("Task 9 Increment 2 listing-flow copy — Web2 language invariant", () => {
  it("every new UI string is free of PROHIBITED_TERMS", () => {
    for (const text of LISTING_FLOW_STRINGS) {
      expect(containsProhibitedTerm(text), `string: "${text}"`).toBe(false);
    }
  });
});
