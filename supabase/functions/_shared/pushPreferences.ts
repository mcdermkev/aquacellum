/**
 * pushPreferences.ts — should this push actually be sent?
 *
 * THE GAP THIS CLOSES. `send-push` accepted a `category` and stored it on the
 * notification row, but never read `profiles.notification_preferences`. So every
 * per-category Push switch in Settings, and the whole Quiet Hours block, were dead
 * controls: a user could turn Push off for Social, or set quiet hours 22:00–08:00,
 * and pushes arrived anyway. Six controls collecting intent and delivering nothing.
 *
 * DELIBERATELY DEPENDENCY-FREE. This file imports nothing, so it is importable
 * both by the Deno Edge Function and by vitest in the frontend workspace. The
 * decision about whether to wake someone at 3am is worth unit-testing, and Deno
 * functions with `https://` imports cannot be loaded by the test runner.
 *
 * ── WHAT SUPPRESSION MEANS HERE ──────────────────────────────────────────────
 * Suppressing a PUSH never suppresses the notification itself. The in-app
 * `sonar_notifications` row is written by the caller regardless, so a quiet-hours
 * push is not lost — it is waiting when the user next opens the app. That is why
 * skipping is acceptable rather than needing a deferral queue.
 */

export interface QuietHours {
  enabled?: boolean;
  start?: string; // "HH:MM"
  end?: string; // "HH:MM"
}

export interface NotificationPreferences {
  categories?: Record<string, { enabled?: boolean; push?: boolean }>;
  quietHours?: QuietHours;
  /** IANA zone, e.g. "America/New_York". Captured from the browser on save. */
  timezone?: string;
}

export interface PushDecision {
  send: boolean;
  reason: string;
}

/**
 * Parse "HH:MM" into minutes since midnight, or null when unusable.
 */
export function parseTimeToMinutes(value: string | undefined | null): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Local wall-clock minutes-since-midnight for an instant in a given IANA zone.
 *
 * ⚠️ Uses `Intl` rather than manual offset maths so daylight saving is handled by
 * the platform. Getting this wrong means quiet hours drift by an hour twice a year,
 * which is exactly the kind of bug nobody reports and everybody resents.
 *
 * Falls back to UTC when the zone is missing or unrecognised — see
 * `shouldSendPush` for why an unknown zone does NOT suppress.
 */
export function localMinutesInZone(instant: Date, timezone?: string): number | null {
  if (!timezone) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(instant);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    // Intl can render midnight as "24" in some engines with hour12:false.
    return (hour % 24) * 60 + minute;
  } catch {
    // Unrecognised time zone.
    return null;
  }
}

/**
 * Is `instant` inside the quiet window, in the user's own timezone?
 *
 * Handles windows that cross midnight (22:00 → 08:00), which is the common case
 * and the one a naive `start <= now && now <= end` comparison gets wrong.
 */
export function isWithinQuietHours(
  quietHours: QuietHours | undefined,
  instant: Date,
  timezone?: string
): boolean {
  if (!quietHours?.enabled) return false;

  const start = parseTimeToMinutes(quietHours.start);
  const end = parseTimeToMinutes(quietHours.end);
  if (start === null || end === null) return false;
  // Equal bounds describe a zero-length window, not a 24-hour one. Treating it as
  // all-day would silently mute a user forever.
  if (start === end) return false;

  const nowMinutes = localMinutesInZone(instant, timezone);
  if (nowMinutes === null) return false;

  return start < end
    ? nowMinutes >= start && nowMinutes < end // same-day window, e.g. 01:00–06:00
    : nowMinutes >= start || nowMinutes < end; // crosses midnight, e.g. 22:00–08:00
}

/**
 * The decision. Returns a reason either way so the caller can report WHY nothing
 * was sent — a silent skip is indistinguishable from a broken push pipeline, which
 * is how this app previously spent months believing push worked when it did not.
 *
 * FAILS OPEN. Missing preferences, an unknown category, or an unrecognised timezone
 * all resolve to "send". The asymmetry is deliberate: an unwanted notification is
 * visible and the user can then turn it off, whereas wrongly suppressing one is
 * silent and indistinguishable from the outage this function had for months.
 *
 * @param prefs - `profiles.notification_preferences`, possibly null
 * @param category - the caller's category, e.g. "social"
 * @param instant - when the push is being sent
 */
export function shouldSendPush(
  prefs: NotificationPreferences | null | undefined,
  category: string | undefined,
  instant: Date = new Date()
): PushDecision {
  if (!prefs) return { send: true, reason: "no_preferences_stored" };

  const resolvedCategory = category || "activity";
  const categoryPrefs = prefs.categories?.[resolvedCategory];

  // An unknown category is not a reason to suppress — a new notification type
  // shipping before its Settings row exists should still reach the user.
  if (categoryPrefs) {
    if (categoryPrefs.enabled === false) {
      return { send: false, reason: `category_disabled:${resolvedCategory}` };
    }
    if (categoryPrefs.push === false) {
      return { send: false, reason: `push_off_for_category:${resolvedCategory}` };
    }
  }

  if (isWithinQuietHours(prefs.quietHours, instant, prefs.timezone)) {
    return { send: false, reason: "quiet_hours" };
  }

  return { send: true, reason: "allowed" };
}
