/**
 * Tests for `api/_lib/weeklyDigest.js` — the weekly digest email sender.
 *
 * WHY THESE SPECIFIC CASES. The digest preference in Settings existed for months
 * and sent nothing: `reef-digest` generated the text and inserted a notification
 * row, and `weeklyDigestTemplate` had zero callers. Now that a sender exists, the
 * risks invert — the failure modes worth guarding are sending when we should not,
 * and sending twice:
 *
 *   - OPT-IN IS EXPLICIT. The digest defaults to "off" in Settings, so anything
 *     other than "weekly" means no. Getting this backwards mails people who never
 *     asked.
 *   - IDEMPOTENCE. A duplicate digest is a spam complaint. Every success stamps
 *     `email_sent_at`, and a FAILED send must NOT stamp, so a transient Resend
 *     error retries next run instead of being silently dropped.
 *   - BACKLOG SUPPRESSION. Because the sender was broken for months, a user can
 *     have several pending digest rows. Mailing all of them at once is worse than
 *     mailing the current one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocked before importing the module under test so its top-level import binds to
// these fakes rather than the real Resend client.
const sendEmail = vi.fn();
const weeklyDigestTemplate = vi.fn(({ displayName, digestText }) => ({
  subject: "🐙 Your Weekly Reef Digest",
  html: `<p>${displayName}</p><p>${digestText}</p>`,
  unsubscribeUrl: "https://example.test/app/settings#settings/notifications",
}));
const unsubscribeHeaders = vi.fn((url) => (url ? { "List-Unsubscribe": `<${url}>` } : undefined));
const isResendConfigured = vi.fn(() => true);

vi.mock("../../api/_lib/resend.js", () => ({
  sendEmail: (...args) => sendEmail(...args),
  weeklyDigestTemplate: (...args) => weeklyDigestTemplate(...args),
  unsubscribeHeaders: (...args) => unsubscribeHeaders(...args),
  isResendConfigured: (...args) => isResendConfigured(...args),
}));

const { sendWeeklyDigests } = await import("../../api/_lib/weeklyDigest.js");

/**
 * Minimal Supabase test double covering only the call shapes the sender uses:
 *   from("sonar_notifications").select(...).eq(...).is(...).order(...).limit(...)
 *   from("profiles").select(...).in(...)
 *   from("sonar_notifications").update(...).eq(...) / .in(...)
 */
function fakeSupabase({ digests = [], profiles = [], updateError = null }) {
  const updates = [];

  const builder = (table) => {
    const chain = {
      _table: table,
      select() { return chain; },
      eq() { return chain; },
      is() { return chain; },
      order() { return chain; },
      in(_col, ids) {
        if (chain._mode === "update") {
          updates.push({ table, ids, payload: chain._payload });
          return Promise.resolve({ error: updateError });
        }
        chain._inIds = ids;
        return Promise.resolve({ data: profiles, error: null });
      },
      limit() { return Promise.resolve({ data: digests, error: null }); },
      update(payload) {
        chain._mode = "update";
        chain._payload = payload;
        return {
          eq: (_col, id) => {
            updates.push({ table, ids: [id], payload });
            return Promise.resolve({ error: updateError });
          },
          in: (_col, ids) => {
            updates.push({ table, ids, payload });
            return Promise.resolve({ error: updateError });
          },
        };
      },
    };
    return chain;
  };

  return { from: (table) => builder(table), _updates: updates };
}

const OPTED_IN = {
  wallet_address: "0xaaa",
  display_name: "Kev",
  email: "kev@example.test",
  notification_preferences: { emailDigest: "weekly" },
};

beforeEach(() => {
  vi.clearAllMocks();
  isResendConfigured.mockReturnValue(true);
  sendEmail.mockResolvedValue({ success: true, id: "email_1" });
});

describe("opt-in gating", () => {
  it("sends to a user whose digest is set to weekly", async () => {
    const supabase = fakeSupabase({
      digests: [{ id: "d1", recipient_wallet: "0xaaa", body: "Your tankmates posted 3 updates.", created_at: "2026-08-02" }],
      profiles: [OPTED_IN],
    });

    const result = await sendWeeklyDigests(supabase);

    expect(result.sent).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe("kev@example.test");
  });

  it("does NOT send when the preference is off", async () => {
    const supabase = fakeSupabase({
      digests: [{ id: "d1", recipient_wallet: "0xaaa", body: "text", created_at: "2026-08-02" }],
      profiles: [{ ...OPTED_IN, notification_preferences: { emailDigest: "off" } }],
    });

    const result = await sendWeeklyDigests(supabase);

    expect(result.sent).toBe(0);
    expect(result.skippedNotOptedIn).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does NOT send when the preference is absent — silence is not consent", async () => {
    // Unlike the retention email, which defaults ON, the digest defaults to "off"
    // in Settings. A profile that has never saved preferences must not be mailed.
    const supabase = fakeSupabase({
      digests: [{ id: "d1", recipient_wallet: "0xaaa", body: "text", created_at: "2026-08-02" }],
      profiles: [{ ...OPTED_IN, notification_preferences: null }],
    });

    const result = await sendWeeklyDigests(supabase);

    expect(result.sent).toBe(0);
    expect(result.skippedNotOptedIn).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does NOT send when there is no email address on file", async () => {
    const supabase = fakeSupabase({
      digests: [{ id: "d1", recipient_wallet: "0xaaa", body: "text", created_at: "2026-08-02" }],
      profiles: [{ ...OPTED_IN, email: null }],
    });

    const result = await sendWeeklyDigests(supabase);

    expect(result.skippedNoAddress).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does NOT send an empty digest body", async () => {
    const supabase = fakeSupabase({
      digests: [{ id: "d1", recipient_wallet: "0xaaa", body: "   ", created_at: "2026-08-02" }],
      profiles: [OPTED_IN],
    });

    const result = await sendWeeklyDigests(supabase);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });
});

describe("idempotence", () => {
  it("stamps email_sent_at after a successful send", async () => {
    const supabase = fakeSupabase({
      digests: [{ id: "d1", recipient_wallet: "0xaaa", body: "text", created_at: "2026-08-02" }],
      profiles: [OPTED_IN],
    });

    await sendWeeklyDigests(supabase);

    const stamp = supabase._updates.find((u) => u.ids.includes("d1"));
    expect(stamp, "successful send must be stamped or it will re-send").toBeTruthy();
    expect(stamp.payload.email_sent_at).toBeTruthy();
  });

  it("does NOT stamp a FAILED send, so a transient error retries next run", async () => {
    sendEmail.mockResolvedValue({ success: false, error: "Resend API error (429)" });
    const supabase = fakeSupabase({
      digests: [{ id: "d1", recipient_wallet: "0xaaa", body: "text", created_at: "2026-08-02" }],
      profiles: [OPTED_IN],
    });

    const result = await sendWeeklyDigests(supabase);

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    expect(supabase._updates.some((u) => u.ids.includes("d1"))).toBe(false);
    expect(result.errors.join(" ")).toMatch(/429/);
  });

  it("reports loudly when mail went out but the stamp failed", async () => {
    // The one state that causes a duplicate next run, so it must not be silent.
    const supabase = fakeSupabase({
      digests: [{ id: "d1", recipient_wallet: "0xaaa", body: "text", created_at: "2026-08-02" }],
      profiles: [OPTED_IN],
      updateError: { message: "connection lost" },
    });

    const result = await sendWeeklyDigests(supabase);

    expect(result.sent).toBe(1);
    expect(result.errors.join(" ")).toMatch(/SENT BUT NOT STAMPED/);
    expect(result.errors.join(" ")).toMatch(/duplicate/);
  });
});

describe("backlog suppression", () => {
  it("mails only the newest pending digest per wallet and retires the rest", async () => {
    // The sender was broken for months, so a backlog is the expected state, not an
    // edge case. Mailing four stale weekly summaries at once would be worse than
    // mailing the current one.
    const supabase = fakeSupabase({
      digests: [
        { id: "new", recipient_wallet: "0xaaa", body: "this week", created_at: "2026-08-02" },
        { id: "old1", recipient_wallet: "0xaaa", body: "last week", created_at: "2026-07-26" },
        { id: "old2", recipient_wallet: "0xaaa", body: "older", created_at: "2026-07-19" },
      ],
      profiles: [OPTED_IN],
    });

    const result = await sendWeeklyDigests(supabase);

    expect(result.sent).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].html).toContain("this week");
    // The superseded rows are stamped so they can never surface later.
    expect(result.supersededRetired).toBe(2);
    const retired = supabase._updates.find((u) => u.ids.length === 2);
    expect(retired.ids).toEqual(["old1", "old2"]);
  });
});

describe("compliance and configuration", () => {
  it("attaches a List-Unsubscribe header", async () => {
    const supabase = fakeSupabase({
      digests: [{ id: "d1", recipient_wallet: "0xaaa", body: "text", created_at: "2026-08-02" }],
      profiles: [OPTED_IN],
    });

    await sendWeeklyDigests(supabase);

    const headers = sendEmail.mock.calls[0][0].headers;
    expect(headers, "recurring mail without List-Unsubscribe is a spam signal").toBeTruthy();
    expect(headers["List-Unsubscribe"]).toMatch(/settings/);
  });

  it("sends nothing and says why when Resend is unconfigured", async () => {
    isResendConfigured.mockReturnValue(false);
    const supabase = fakeSupabase({
      digests: [{ id: "d1", recipient_wallet: "0xaaa", body: "text", created_at: "2026-08-02" }],
      profiles: [OPTED_IN],
    });

    const result = await sendWeeklyDigests(supabase);

    expect(result.sent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.errors.join(" ")).toMatch(/RESEND_API_KEY/);
  });

  it("reports zero work cleanly when nothing is pending", async () => {
    const supabase = fakeSupabase({ digests: [], profiles: [] });
    const result = await sendWeeklyDigests(supabase);
    expect(result).toMatchObject({ pending: 0, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
