/**
 * Tests for services/sellerVacation.js.
 *
 * This is money-path code: it decides whether a seller can take an order. The two
 * directions of error are NOT symmetric, and the tests encode that asymmetry
 * deliberately —
 *
 *   FAILING OPEN (treating a paused seller as available) means an order arrives for
 *   live animals the breeder cannot ship. Bad, but visible: the breeder sees the
 *   order and can cancel.
 *
 *   FAILING CLOSED (treating an available seller as paused) silently kills their
 *   sales with no signal at all. Worse, because nobody finds out.
 *
 * So corrupt or unreadable state must resolve to AVAILABLE, and only a clearly
 * future timestamp pauses a store.
 */

import { describe, it, expect } from "vitest";
import {
  MAX_VACATION_DAYS,
  isSellerPaused,
  pausedSellerSet,
  vacationDaysRemaining,
  vacationNotice,
  validateVacationUntil,
} from "./sellerVacation.js";

const NOW = new Date("2026-08-04T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

function at(offsetMs) {
  return new Date(NOW + offsetMs).toISOString();
}

describe("isSellerPaused", () => {
  it("is not paused when vacation_until is unset", () => {
    expect(isSellerPaused({ vacation_until: null }, NOW)).toBe(false);
    expect(isSellerPaused({}, NOW)).toBe(false);
  });

  it("is paused for a future timestamp", () => {
    expect(isSellerPaused({ vacation_until: at(5 * DAY) }, NOW)).toBe(true);
  });

  it("auto-resumes once the date passes — no manual step", () => {
    // The reason this is a date and not a boolean: a forgotten boolean keeps the
    // store shut indefinitely and the breeder only notices via missing sales.
    expect(isSellerPaused({ vacation_until: at(-1 * DAY) }, NOW)).toBe(false);
  });

  it("is not paused exactly at the boundary", () => {
    // Ties resolve to available, consistent with failing open.
    expect(isSellerPaused({ vacation_until: at(0) }, NOW)).toBe(false);
  });

  it("FAILS OPEN on an unparseable timestamp", () => {
    // Corrupt data must not shut a store. Wrongly pausing is the silent failure.
    expect(isSellerPaused({ vacation_until: "not-a-date" }, NOW)).toBe(false);
    expect(isSellerPaused({ vacation_until: "" }, NOW)).toBe(false);
  });

  it("FAILS OPEN on a missing profile", () => {
    expect(isSellerPaused(null, NOW)).toBe(false);
    expect(isSellerPaused(undefined, NOW)).toBe(false);
  });
});

describe("vacationDaysRemaining", () => {
  it("rounds up, so a partial day still reads as a day", () => {
    expect(vacationDaysRemaining({ vacation_until: at(1.2 * DAY) }, NOW)).toBe(2);
    expect(vacationDaysRemaining({ vacation_until: at(0.1 * DAY) }, NOW)).toBe(1);
  });

  it("is zero when not paused", () => {
    expect(vacationDaysRemaining({ vacation_until: null }, NOW)).toBe(0);
    expect(vacationDaysRemaining({ vacation_until: at(-DAY) }, NOW)).toBe(0);
  });
});

describe("vacationNotice", () => {
  it("gives buyers a return date rather than a bare 'unavailable'", () => {
    // "Back on the 9th" tells a buyer to wait; "unavailable" sends them elsewhere.
    const notice = vacationNotice({ vacation_until: at(5 * DAY) }, NOW);
    expect(notice).toMatch(/away until/i);
    expect(notice).toMatch(/5 days/);
  });

  it("reads naturally for a single day", () => {
    expect(vacationNotice({ vacation_until: at(0.5 * DAY) }, NOW)).toMatch(/back tomorrow/i);
  });

  it("is null for an available seller, so callers render nothing", () => {
    expect(vacationNotice({ vacation_until: null }, NOW)).toBeNull();
  });
});

describe("pausedSellerSet", () => {
  it("lowercases wallets, because casing is inconsistent in this schema", () => {
    // A case mismatch here would silently fail to pause a seller — supabaseClient
    // carries a whole case-resolution cache precisely because of this hazard.
    const set = pausedSellerSet(
      [{ wallet_address: "0xAbCdEf", vacation_until: at(DAY) }],
      NOW
    );
    expect(set.has("0xabcdef")).toBe(true);
  });

  it("excludes sellers whose pause has expired", () => {
    const set = pausedSellerSet(
      [
        { wallet_address: "0xpaused", vacation_until: at(DAY) },
        { wallet_address: "0xback", vacation_until: at(-DAY) },
      ],
      NOW
    );
    expect(set.has("0xpaused")).toBe(true);
    expect(set.has("0xback")).toBe(false);
  });

  it("tolerates junk rows without throwing", () => {
    const set = pausedSellerSet([null, {}, { vacation_until: at(DAY) }], NOW);
    expect(set.size).toBe(0);
  });

  it("returns an empty set for no input — the fail-open default", () => {
    expect(pausedSellerSet(null, NOW).size).toBe(0);
    expect(pausedSellerSet([], NOW).size).toBe(0);
  });
});

describe("validateVacationUntil", () => {
  it("accepts a sensible future date", () => {
    const result = validateVacationUntil(new Date(NOW + 7 * DAY), NOW);
    expect(result.ok).toBe(true);
    expect(result.iso).toBeTruthy();
  });

  it("rejects a past date", () => {
    expect(validateVacationUntil(new Date(NOW - DAY), NOW).ok).toBe(false);
  });

  it("rejects an unreadable date", () => {
    expect(validateVacationUntil("gibberish", NOW).ok).toBe(false);
  });

  it("caps the pause length so a typo cannot shut a store for a decade", () => {
    const tooLong = validateVacationUntil(new Date(NOW + (MAX_VACATION_DAYS + 1) * DAY), NOW);
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error).toMatch(new RegExp(`${MAX_VACATION_DAYS}`));

    const atLimit = validateVacationUntil(new Date(NOW + MAX_VACATION_DAYS * DAY), NOW);
    expect(atLimit.ok).toBe(true);
  });
});
