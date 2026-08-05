/**
 * Tests for supabase/functions/_shared/pushPreferences.ts — the push suppression
 * decision.
 *
 * WHY THIS MATTERS. `send-push` used to ignore `notification_preferences` entirely,
 * so every per-category Push switch in Settings and the whole Quiet Hours block were
 * dead controls: turning Social push off, or setting 22:00–08:00, changed nothing.
 * This is the code that makes those six controls real, and it decides whether to
 * wake someone at 3am — so the boundaries are worth pinning precisely.
 *
 * THE ERROR DIRECTIONS ARE ASYMMETRIC and the module encodes that. An unwanted
 * notification is visible, and the user can then turn it off. Wrongly SUPPRESSING
 * one is silent and indistinguishable from the months-long push outage this app
 * already had once. So missing preferences, unknown categories and unrecognised
 * timezones all resolve to "send".
 *
 * The module is dependency-free precisely so it can be tested here rather than only
 * running inside Deno.
 */

import { describe, it, expect } from "vitest";
import {
  isWithinQuietHours,
  localMinutesInZone,
  parseTimeToMinutes,
  shouldSendPush,
} from "../../../supabase/functions/_shared/pushPreferences.ts";

/** 2026-08-04 is a Tuesday. Times below are UTC unless a zone is given. */
function utc(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 7, 4, h, m, 0));
}

const ALL_ON = {
  categories: {
    activity: { enabled: true, push: true },
    social: { enabled: true, push: true },
  },
  quietHours: { enabled: false, start: "22:00", end: "08:00" },
  timezone: "UTC",
};

describe("parseTimeToMinutes", () => {
  it("parses wall-clock times", () => {
    expect(parseTimeToMinutes("00:00")).toBe(0);
    expect(parseTimeToMinutes("22:00")).toBe(1320);
    expect(parseTimeToMinutes("8:30")).toBe(510);
  });

  it("rejects nonsense rather than coercing it", () => {
    // A garbage bound must not become a real window that mutes someone.
    expect(parseTimeToMinutes("25:00")).toBeNull();
    expect(parseTimeToMinutes("12:99")).toBeNull();
    expect(parseTimeToMinutes("noon")).toBeNull();
    expect(parseTimeToMinutes("")).toBeNull();
    expect(parseTimeToMinutes(undefined)).toBeNull();
  });
});

describe("localMinutesInZone", () => {
  it("converts an instant into local wall-clock minutes", () => {
    // 02:00 UTC is 22:00 the previous day in New York (EDT, UTC-4).
    expect(localMinutesInZone(utc("02:00"), "America/New_York")).toBe(22 * 60);
  });

  it("handles daylight saving via Intl rather than fixed offsets", () => {
    // August is EDT (UTC-4); January is EST (UTC-5). A hardcoded offset would drift
    // by an hour twice a year — the classic quiet-hours bug nobody reports.
    const summer = new Date(Date.UTC(2026, 7, 4, 12, 0));
    const winter = new Date(Date.UTC(2026, 0, 4, 12, 0));
    expect(localMinutesInZone(summer, "America/New_York")).toBe(8 * 60);
    expect(localMinutesInZone(winter, "America/New_York")).toBe(7 * 60);
  });

  it("returns null for a missing or unrecognised zone", () => {
    expect(localMinutesInZone(utc("12:00"), undefined)).toBeNull();
    expect(localMinutesInZone(utc("12:00"), "Mars/Olympus_Mons")).toBeNull();
  });
});

describe("isWithinQuietHours", () => {
  const overnight = { enabled: true, start: "22:00", end: "08:00" };

  it("suppresses inside a window that crosses midnight", () => {
    // The common case, and the one a naive start<=now<=end comparison gets wrong.
    expect(isWithinQuietHours(overnight, utc("23:30"), "UTC")).toBe(true);
    expect(isWithinQuietHours(overnight, utc("03:00"), "UTC")).toBe(true);
    expect(isWithinQuietHours(overnight, utc("07:59"), "UTC")).toBe(true);
  });

  it("allows outside that window", () => {
    expect(isWithinQuietHours(overnight, utc("08:00"), "UTC")).toBe(false);
    expect(isWithinQuietHours(overnight, utc("12:00"), "UTC")).toBe(false);
    expect(isWithinQuietHours(overnight, utc("21:59"), "UTC")).toBe(false);
  });

  it("is inclusive at the start and exclusive at the end", () => {
    // So a 22:00–08:00 window mutes at exactly 22:00 and resumes at exactly 08:00,
    // rather than leaving a one-minute hole at either edge.
    expect(isWithinQuietHours(overnight, utc("22:00"), "UTC")).toBe(true);
    expect(isWithinQuietHours(overnight, utc("08:00"), "UTC")).toBe(false);
  });

  it("handles a same-day window", () => {
    const daytime = { enabled: true, start: "01:00", end: "06:00" };
    expect(isWithinQuietHours(daytime, utc("03:00"), "UTC")).toBe(true);
    expect(isWithinQuietHours(daytime, utc("07:00"), "UTC")).toBe(false);
    expect(isWithinQuietHours(daytime, utc("00:30"), "UTC")).toBe(false);
  });

  it("resolves in the USER's timezone, not the server's", () => {
    // The reason a timezone is captured at all. 02:00 UTC is 22:00 in New York, so
    // a New Yorker with 22:00–08:00 quiet hours IS muted, while the same instant is
    // 03:00 in UTC — both inside the window here, so use a discriminating instant:
    // 12:00 UTC is 08:00 New York (allowed) but 12:00 UTC (allowed) too. Use 01:00
    // UTC = 21:00 New York, which is OUTSIDE New York's window but INSIDE UTC's.
    expect(isWithinQuietHours(overnight, utc("01:00"), "America/New_York")).toBe(false);
    expect(isWithinQuietHours(overnight, utc("01:00"), "UTC")).toBe(true);
  });

  it("does nothing when quiet hours are off", () => {
    expect(isWithinQuietHours({ enabled: false, start: "22:00", end: "08:00" }, utc("23:00"), "UTC")).toBe(false);
    expect(isWithinQuietHours(undefined, utc("23:00"), "UTC")).toBe(false);
  });

  it("treats equal bounds as a zero-length window, never all day", () => {
    // Otherwise a user who set both to the same time would be muted forever with no
    // obvious cause.
    expect(isWithinQuietHours({ enabled: true, start: "09:00", end: "09:00" }, utc("09:00"), "UTC")).toBe(false);
    expect(isWithinQuietHours({ enabled: true, start: "09:00", end: "09:00" }, utc("15:00"), "UTC")).toBe(false);
  });

  it("FAILS OPEN on an unusable window or unknown zone", () => {
    expect(isWithinQuietHours({ enabled: true, start: "oops", end: "08:00" }, utc("23:00"), "UTC")).toBe(false);
    expect(isWithinQuietHours(overnight, utc("23:00"), undefined)).toBe(false);
    expect(isWithinQuietHours(overnight, utc("23:00"), "Nowhere/Nothing")).toBe(false);
  });
});

describe("shouldSendPush", () => {
  it("sends when everything is on", () => {
    expect(shouldSendPush(ALL_ON, "social", utc("12:00"))).toEqual({
      send: true,
      reason: "allowed",
    });
  });

  it("suppresses when push is off for that category", () => {
    // The switch that previously did nothing at all.
    const prefs = { ...ALL_ON, categories: { social: { enabled: true, push: false } } };
    const decision = shouldSendPush(prefs, "social", utc("12:00"));
    expect(decision.send).toBe(false);
    expect(decision.reason).toContain("push_off_for_category");
  });

  it("suppresses when the whole category is disabled", () => {
    const prefs = { ...ALL_ON, categories: { social: { enabled: false, push: true } } };
    expect(shouldSendPush(prefs, "social", utc("12:00")).send).toBe(false);
  });

  it("only affects the category asked about", () => {
    const prefs = {
      ...ALL_ON,
      categories: { social: { enabled: true, push: false }, activity: { enabled: true, push: true } },
    };
    expect(shouldSendPush(prefs, "social", utc("12:00")).send).toBe(false);
    expect(shouldSendPush(prefs, "activity", utc("12:00")).send).toBe(true);
  });

  it("suppresses during quiet hours even when the category is allowed", () => {
    const prefs = { ...ALL_ON, quietHours: { enabled: true, start: "22:00", end: "08:00" } };
    const decision = shouldSendPush(prefs, "social", utc("23:00"));
    expect(decision.send).toBe(false);
    expect(decision.reason).toBe("quiet_hours");
  });

  it("defaults an absent category to 'activity'", () => {
    const prefs = { ...ALL_ON, categories: { activity: { enabled: true, push: false } } };
    expect(shouldSendPush(prefs, undefined, utc("12:00")).send).toBe(false);
  });

  it("FAILS OPEN with no stored preferences", () => {
    // A user who has never opened Settings must still get their notifications.
    expect(shouldSendPush(null, "social", utc("12:00"))).toEqual({
      send: true,
      reason: "no_preferences_stored",
    });
    expect(shouldSendPush(undefined, "social", utc("12:00")).send).toBe(true);
  });

  it("FAILS OPEN for a category with no stored row", () => {
    // A new notification type shipping before its Settings row exists should still
    // reach the user rather than being silently dropped.
    expect(shouldSendPush(ALL_ON, "brand_new_type", utc("12:00")).send).toBe(true);
  });

  it("always gives a reason, so a skip is never mistaken for a broken pipeline", () => {
    // The lesson from the push outage: a silent zero is indistinguishable from
    // failure. Every decision is explainable.
    for (const decision of [
      shouldSendPush(null, "social", utc("12:00")),
      shouldSendPush(ALL_ON, "social", utc("12:00")),
      shouldSendPush({ ...ALL_ON, categories: { social: { push: false } } }, "social", utc("12:00")),
      shouldSendPush({ ...ALL_ON, quietHours: { enabled: true, start: "22:00", end: "08:00" } }, "social", utc("23:00")),
    ]) {
      expect(decision.reason).toBeTruthy();
      expect(typeof decision.reason).toBe("string");
    }
  });
});
