/**
 * Unit tests for pickupCoordination.js — the pure core for Task 25 (local
 * pickup coordination). See docs/TASK_25_PICKUP_COORDINATION_SPEC.md §6.
 *
 * Run with: npx vitest --run src/__tests__/pickupCoordination.test.js
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  normalizePickupLocation,
  validatePickupLocationDraft,
  validateAvailabilityWindow,
  resolveAvailableSlots,
  validateProposedTime,
  arrangementStatusView,
  ARRANGEMENT_STATUS_KIND,
  MAX_LABEL_LENGTH,
  MAX_NOTES_LENGTH,
  containsProhibitedTerm,
} from "../services/pickupCoordination.js";

const NOW = Date.parse("2026-07-24T12:00:00.000Z"); // a Friday

function windowDow(dow, start, end, tz = "America/New_York") {
  return { dow, start, end, tz };
}

function windowDate(date, start, end, tz = "America/New_York") {
  return { date, start, end, tz };
}

// ─── 1. resolveAvailableSlots ────────────────────────────────────────────────

describe("resolveAvailableSlots", () => {
  it("expands a recurring weekly window into upcoming instances within the horizon", () => {
    // NOW is Friday 2026-07-24. Window recurs every Friday (dow=5).
    const location = { availability: [windowDow(5, "17:00", "19:00")] };
    const slots = resolveAvailableSlots(location, { now: NOW, horizonDays: 14 });
    expect(slots.length).toBeGreaterThan(0);
    // Every slot must fall on a Friday in America/New_York.
    for (const slot of slots) {
      const startMs = Date.parse(slot.startISO);
      expect(startMs).toBeGreaterThan(NOW - 86400000); // sane range
    }
  });

  it("expands a one-off date window only on that exact date", () => {
    const location = { availability: [windowDate("2026-07-30", "10:00", "12:00")] };
    const slots = resolveAvailableSlots(location, { now: NOW, horizonDays: 14 });
    expect(slots).toHaveLength(1);
  });

  it("does not include a one-off date window outside the horizon", () => {
    const location = { availability: [windowDate("2026-09-01", "10:00", "12:00")] };
    const slots = resolveAvailableSlots(location, { now: NOW, horizonDays: 14 });
    expect(slots).toHaveLength(0);
  });

  it("does not include a window that has already fully elapsed today", () => {
    // NOW is 2026-07-24T12:00:00Z. A window on that same date ending in the past.
    const location = { availability: [windowDate("2026-07-24", "00:00", "01:00", "UTC")] };
    const slots = resolveAvailableSlots(location, { now: NOW, horizonDays: 14 });
    expect(slots).toHaveLength(0);
  });

  it("is deterministic for a fixed now", () => {
    const location = { availability: [windowDow(1, "09:00", "11:00"), windowDate("2026-08-01", "13:00", "14:00")] };
    const a = resolveAvailableSlots(location, { now: NOW });
    const b = resolveAvailableSlots(location, { now: NOW });
    expect(a).toEqual(b);
  });

  it("respects each window's own tz (a fixed UTC instant differs from a fixed America/New_York instant)", () => {
    const utcLoc = { availability: [windowDate("2026-07-25", "12:00", "13:00", "UTC")] };
    const nyLoc = { availability: [windowDate("2026-07-25", "12:00", "13:00", "America/New_York")] };
    const utcSlots = resolveAvailableSlots(utcLoc, { now: NOW });
    const nySlots = resolveAvailableSlots(nyLoc, { now: NOW });
    expect(utcSlots[0].startISO).not.toBe(nySlots[0].startISO);
  });

  it("sorts slots ascending by start time", () => {
    const location = { availability: [windowDate("2026-08-01", "10:00", "11:00", "UTC"), windowDate("2026-07-25", "10:00", "11:00", "UTC")] };
    const slots = resolveAvailableSlots(location, { now: NOW });
    const sorted = [...slots].sort((a, b) => a.startISO.localeCompare(b.startISO));
    expect(slots).toEqual(sorted);
  });

  it("skips malformed windows without throwing", () => {
    const location = { availability: [{ start: "bad" }, null, windowDate("2026-07-25", "10:00", "11:00", "UTC")] };
    expect(() => resolveAvailableSlots(location, { now: NOW })).not.toThrow();
    expect(resolveAvailableSlots(location, { now: NOW })).toHaveLength(1);
  });

  it("handles a missing/empty availability array without throwing", () => {
    expect(() => resolveAvailableSlots({}, { now: NOW })).not.toThrow();
    expect(resolveAvailableSlots({ availability: [] }, { now: NOW })).toEqual([]);
    expect(resolveAvailableSlots(null, { now: NOW })).toEqual([]);
  });
});

// ─── 2. validateProposedTime ─────────────────────────────────────────────────

describe("validateProposedTime", () => {
  const location = { availability: [windowDate("2026-07-25", "10:00", "12:00", "UTC")] };

  it("accepts a time inside an availability window", () => {
    const result = validateProposedTime(location, "2026-07-25T11:00:00.000Z", { now: NOW });
    expect(result).toEqual({ ok: true, error: null });
  });

  it("rejects a time before now (past)", () => {
    const result = validateProposedTime(location, "2026-01-01T10:00:00.000Z", { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/past/);
  });

  it("rejects a time outside every window", () => {
    const result = validateProposedTime(location, "2026-07-25T15:00:00.000Z", { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/availability/);
  });

  it("rejects a time beyond the scheduling horizon", () => {
    const farLocation = { availability: [windowDate("2026-12-01", "10:00", "12:00", "UTC")] };
    const result = validateProposedTime(farLocation, "2026-12-01T11:00:00.000Z", { now: NOW, horizonDays: 14 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/horizon/);
  });

  it("rejects an unparsable date string", () => {
    const result = validateProposedTime(location, "not-a-date", { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid date/);
  });
});

// ─── 3. validatePickupLocationDraft / validateAvailabilityWindow ────────────

describe("validatePickupLocationDraft", () => {
  it("accepts a well-formed draft", () => {
    const result = validatePickupLocationDraft({
      label: "Riverside Park lot",
      lat: 40.7,
      lng: -74.0,
      addressText: "123 River Rd",
      notes: "Meet by the fountain",
      availability: [windowDow(5, "17:00", "19:00")],
    });
    expect(result).toEqual({ ok: true, error: null });
  });

  it("rejects a missing label", () => {
    expect(validatePickupLocationDraft({}).ok).toBe(false);
    expect(validatePickupLocationDraft({ label: "   " }).ok).toBe(false);
  });

  it("rejects an over-long label", () => {
    const result = validatePickupLocationDraft({ label: "x".repeat(MAX_LABEL_LENGTH + 1) });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/80/);
  });

  it("rejects an over-long notes field", () => {
    const result = validatePickupLocationDraft({ label: "Spot", notes: "x".repeat(MAX_NOTES_LENGTH + 1) });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
  });

  it("rejects out-of-range lat", () => {
    expect(validatePickupLocationDraft({ label: "Spot", lat: 91 }).ok).toBe(false);
    expect(validatePickupLocationDraft({ label: "Spot", lat: -91 }).ok).toBe(false);
  });

  it("rejects out-of-range lng", () => {
    expect(validatePickupLocationDraft({ label: "Spot", lng: 181 }).ok).toBe(false);
    expect(validatePickupLocationDraft({ label: "Spot", lng: -181 }).ok).toBe(false);
  });

  it("accepts a draft with no coordinates set (address-text-only spot)", () => {
    const result = validatePickupLocationDraft({ label: "Spot", addressText: "Somewhere" });
    expect(result).toEqual({ ok: true, error: null });
  });

  it("rejects malformed availability (non-array)", () => {
    const result = validatePickupLocationDraft({ label: "Spot", availability: "nope" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/array/);
  });

  it("rejects a window with both dow and date set", () => {
    const result = validatePickupLocationDraft({ label: "Spot", availability: [{ dow: 1, date: "2026-07-25", start: "10:00", end: "11:00", tz: "UTC" }] });
    expect(result.ok).toBe(false);
  });

  it("rejects a window with neither dow nor date set", () => {
    const result = validatePickupLocationDraft({ label: "Spot", availability: [{ start: "10:00", end: "11:00", tz: "UTC" }] });
    expect(result.ok).toBe(false);
  });

  it("rejects a window with start >= end", () => {
    const result = validatePickupLocationDraft({ label: "Spot", availability: [windowDow(1, "12:00", "10:00", "UTC")] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/before/);
  });

  it("rejects a window with a bad HH:mm format", () => {
    const result = validatePickupLocationDraft({ label: "Spot", availability: [{ dow: 1, start: "9am", end: "11:00", tz: "UTC" }] });
    expect(result.ok).toBe(false);
  });

  it("rejects a window with an out-of-range dow", () => {
    const result = validatePickupLocationDraft({ label: "Spot", availability: [windowDow(7, "10:00", "11:00", "UTC")] });
    expect(result.ok).toBe(false);
  });

  it("rejects a window with a malformed date", () => {
    const result = validatePickupLocationDraft({ label: "Spot", availability: [windowDate("07/25/2026", "10:00", "11:00", "UTC")] });
    expect(result.ok).toBe(false);
  });

  it("rejects a window missing tz", () => {
    const result = validatePickupLocationDraft({ label: "Spot", availability: [{ dow: 1, start: "10:00", end: "11:00" }] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/tz/);
  });

  it("rejects a window with an unrecognized tz string", () => {
    const result = validatePickupLocationDraft({ label: "Spot", availability: [windowDow(1, "10:00", "11:00", "Not/A_Zone")] });
    expect(result.ok).toBe(false);
  });
});

describe("validateAvailabilityWindow", () => {
  it("accepts a well-formed recurring window", () => {
    expect(validateAvailabilityWindow(windowDow(3, "09:00", "17:00"))).toEqual({ ok: true, error: null });
  });

  it("accepts a well-formed one-off window", () => {
    expect(validateAvailabilityWindow(windowDate("2026-07-25", "09:00", "17:00"))).toEqual({ ok: true, error: null });
  });

  it("rejects a non-object input", () => {
    expect(validateAvailabilityWindow(null).ok).toBe(false);
    expect(validateAvailabilityWindow("nope").ok).toBe(false);
  });
});

// ─── 4. normalizePickupLocation ──────────────────────────────────────────────

describe("normalizePickupLocation", () => {
  it("normalizes a snake_case DB row to camelCase", () => {
    const row = {
      id: "abc",
      wallet_address: "0xABC",
      label: "Park lot",
      lat: 40.7,
      lng: -74.0,
      address_text: "123 River Rd",
      notes: "Meet by the fountain",
      availability: [windowDow(5, "17:00", "19:00")],
      active: true,
      sort_order: 2,
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
    };
    const normalized = normalizePickupLocation(row);
    expect(normalized).toEqual({
      id: "abc",
      walletAddress: "0xabc",
      label: "Park lot",
      lat: 40.7,
      lng: -74.0,
      addressText: "123 River Rd",
      notes: "Meet by the fountain",
      availability: [windowDow(5, "17:00", "19:00")],
      active: true,
      sortOrder: 2,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    });
  });

  it("defaults active to true and sortOrder to 0 when absent", () => {
    const normalized = normalizePickupLocation({ label: "Spot" });
    expect(normalized.active).toBe(true);
    expect(normalized.sortOrder).toBe(0);
    expect(normalized.availability).toEqual([]);
  });

  it("handles a missing/empty input without throwing", () => {
    expect(() => normalizePickupLocation()).not.toThrow();
    expect(() => normalizePickupLocation({})).not.toThrow();
  });
});

// ─── 5. arrangementStatusView — Web2 language invariant ─────────────────────

describe("arrangementStatusView", () => {
  it("returns the correct status/label/nextAction for every ARRANGEMENT_STATUS_KIND", () => {
    for (const kind of Object.values(ARRANGEMENT_STATUS_KIND)) {
      const view = arrangementStatusView({ status: kind });
      expect(view.status).toBe(kind);
      expect(typeof view.label).toBe("string");
      expect(typeof view.nextAction).toBe("string");
    }
  });

  it("defaults an unknown/missing status to 'none'", () => {
    expect(arrangementStatusView({}).status).toBe(ARRANGEMENT_STATUS_KIND.NONE);
    expect(arrangementStatusView({ status: "bogus" }).status).toBe(ARRANGEMENT_STATUS_KIND.NONE);
  });

  it("switches between casual and pro copy", () => {
    const casual = arrangementStatusView({ status: "confirmed" }, { casual: true });
    const pro = arrangementStatusView({ status: "confirmed" }, { casual: false });
    expect(casual.label).not.toBe(pro.label);
  });

  it("every status/nextAction string is free of PROHIBITED_TERMS", () => {
    for (const kind of Object.values(ARRANGEMENT_STATUS_KIND)) {
      for (const casual of [true, false]) {
        const view = arrangementStatusView({ status: kind }, { casual });
        expect(containsProhibitedTerm(view.label), `label for ${kind} casual=${casual}`).toBe(false);
        expect(containsProhibitedTerm(view.nextAction), `nextAction for ${kind} casual=${casual}`).toBe(false);
      }
    }
  });
});

// ─── 6. Source-guard — Guardrail 1 (no settlement/reservation imports) ──────

describe("pickupCoordination.js — source guard (Guardrail 1)", () => {
  const SOURCE = readFileSync(fileURLToPath(new URL("../services/pickupCoordination.js", import.meta.url)), "utf8");

  it("imports nothing from settlement/reservation/ledger/canonicalSettlement modules", () => {
    expect(SOURCE).not.toMatch(/from\s+["'].*settlementCoordinator/);
    expect(SOURCE).not.toMatch(/from\s+["'].*paymentLedger/);
    expect(SOURCE).not.toMatch(/from\s+["'].*reservation/i);
    expect(SOURCE).not.toMatch(/from\s+["'].*canonicalSettlement/);
  });

  it("only imports from orderCopy.js (no network/db client imports)", () => {
    const importLines = SOURCE.split("\n").filter((l) => l.trim().startsWith("import "));
    for (const line of importLines) {
      expect(line).toMatch(/orderCopy\.js/);
    }
  });
});
