/**
 * weeklyDigest.js — sends the weekly Reef Digest by email.
 *
 * THE GAP THIS CLOSES. Settings has offered an "Email Digest" preference for
 * months and it sent nothing. `reef-digest` (a Supabase Edge Function) generated
 * the digest text and inserted a `sonar_notifications` row, then stopped;
 * `weeklyDigestTemplate` in `_lib/resend.js` had **zero callers**. So the control
 * stored an intent that nothing acted on — the exact defect the Settings rework
 * exists to remove.
 *
 * DESIGN: ONE GENERATOR, ONE SENDER. This does not regenerate anything. The Edge
 * Function already produces the personalised text (it has the Gemini key and the
 * social context), so this mails the rows that already exist. Duplicating the
 * generation here would mean two prompts, two costs, and two versions of "what
 * happened this week" that could disagree.
 *
 * WHY IT LIVES IN `_lib/` AND HANGS OFF `retention.js`. `frontend/api/` is at
 * Vercel Hobby's 12-function ceiling and a 13th top-level file fails the deploy
 * (pinned by `src/__tests__/serverlessFunctionBudget.test.js`). Underscore-prefixed
 * files are not counted, so the logic lives here and `retention.js` dispatches to
 * it as `?action=weekly-digest` — the pattern `?action=test-push` already uses.
 * It also belongs beside the retention mail: same Resend key, same opt-out
 * discipline, same cron authorization.
 *
 * IDEMPOTENCE IS NOT OPTIONAL. A duplicate digest is a spam complaint, so every
 * successful send stamps `email_sent_at` on the row and the query only ever selects
 * rows where it is NULL. A cron retry, an overlapping run, or a manual trigger
 * therefore cannot re-send the same digest.
 */

import { sendEmail, weeklyDigestTemplate, unsubscribeHeaders, isResendConfigured } from "./resend.js";

/** Safety cap per run, matching MAX_EMAIL_PER_RUN in retention.js. */
const MAX_DIGEST_EMAILS_PER_RUN = 200;

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase - service-role client
 * @returns {Promise<object>} per-run counters, returned to the caller for logging
 */
export async function sendWeeklyDigests(supabase) {
  const results = {
    pending: 0,
    sent: 0,
    skippedNoAddress: 0,
    skippedNotOptedIn: 0,
    failed: 0,
    errors: [],
  };

  if (!isResendConfigured()) {
    results.errors.push("Resend not configured (missing RESEND_API_KEY) — nothing sent");
    return results;
  }

  // 1. Digest rows that have never been emailed. Covered by the partial index
  //    added in 20260804160000_digest_email_tracking.sql.
  const { data: pendingDigests, error: digestError } = await supabase
    .from("sonar_notifications")
    .select("id, recipient_wallet, body, created_at")
    .eq("link_type", "digest")
    .is("email_sent_at", null)
    .order("created_at", { ascending: false })
    .limit(MAX_DIGEST_EMAILS_PER_RUN);

  if (digestError) {
    results.errors.push(`digest query failed: ${digestError.message}`);
    return results;
  }

  results.pending = (pendingDigests || []).length;
  if (results.pending === 0) return results;

  // 2. One batched profile lookup rather than a query per digest.
  const wallets = [...new Set(pendingDigests.map((d) => d.recipient_wallet).filter(Boolean))];
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("wallet_address, display_name, email, notification_preferences")
    .in("wallet_address", wallets);

  if (profileError) {
    results.errors.push(`profile lookup failed: ${profileError.message}`);
    return results;
  }

  const byWallet = new Map((profiles || []).map((p) => [p.wallet_address, p]));

  // 3. Only send to the most recent pending digest per wallet. If a user somehow
  //    has a backlog (the sender was broken for months, so they might), mailing
  //    every stale weekly summary at once would be worse than mailing the current
  //    one — older rows are still marked sent so they never resurface.
  const newestPerWallet = new Map();
  const supersededIds = [];
  for (const digest of pendingDigests) {
    if (newestPerWallet.has(digest.recipient_wallet)) {
      supersededIds.push(digest.id);
    } else {
      newestPerWallet.set(digest.recipient_wallet, digest);
    }
  }

  for (const digest of newestPerWallet.values()) {
    const profile = byWallet.get(digest.recipient_wallet);

    if (!profile?.email) {
      results.skippedNoAddress++;
      continue;
    }

    // Explicit opt-in only. Unlike the retention email (which defaults on), the
    // digest defaults to "off" in Settings, so silence means no.
    if (profile.notification_preferences?.emailDigest !== "weekly") {
      results.skippedNotOptedIn++;
      continue;
    }

    const digestText = (digest.body || "").trim();
    if (!digestText) {
      results.skippedNotOptedIn++;
      continue;
    }

    const { subject, html, unsubscribeUrl } = weeklyDigestTemplate({
      displayName: profile.display_name,
      digestText,
    });

    const emailResult = await sendEmail({
      to: profile.email,
      subject,
      html,
      headers: unsubscribeHeaders(unsubscribeUrl),
    });

    if (!emailResult.success) {
      results.failed++;
      results.errors.push(`digest email ${digest.recipient_wallet}: ${emailResult.error}`);
      // Deliberately NOT stamped: leaving `email_sent_at` NULL lets the next run
      // retry a transient Resend failure.
      continue;
    }

    const { error: stampError } = await supabase
      .from("sonar_notifications")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("id", digest.id);

    if (stampError) {
      // The mail went out but we could not record it. Surface loudly — an
      // un-stamped sent digest is exactly what causes a duplicate next run.
      results.errors.push(
        `SENT BUT NOT STAMPED ${digest.id} (${digest.recipient_wallet}): ${stampError.message} — ` +
          `risk of duplicate send on the next run`
      );
    }

    results.sent++;
  }

  // Retire the superseded backlog so it cannot be mailed later.
  if (supersededIds.length > 0) {
    const { error } = await supabase
      .from("sonar_notifications")
      .update({ email_sent_at: new Date().toISOString() })
      .in("id", supersededIds);
    if (error) results.errors.push(`superseded stamp failed: ${error.message}`);
    else results.supersededRetired = supersededIds.length;
  }

  return results;
}

export default sendWeeklyDigests;
