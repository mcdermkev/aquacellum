/**
 * retention.js — Vercel Serverless Function: /api/retention
 *
 * Daily retention job (Vercel Cron, once/day — the max cadence on Hobby).
 * Finds two categories of users and nudges them via push + email:
 *
 *   1. Streak-at-risk: streak_days > 0 AND last_active_date is "yesterday"
 *      (i.e. their streak lapses today if they don't act). Mirrors the
 *      20-hour threshold echo-nudge already uses for its push-only version,
 *      but this batch also sends the win-back email since echo-nudge doesn't
 *      touch email at all.
 *   2. Inactive win-back: last_active_date is 3, 7, or 14 days ago exactly
 *      (fixed touchpoints, not "3+ days ago every day" — avoids spamming the
 *      same lapsed user daily).
 *
 * Respects notification_preferences.retentionEmail (email opt-out) and only
 * sends push to users with an active push_subscriptions row. Both channels
 * are best-effort and independent — a failure in one doesn't block the other.
 *
 * Routes:
 *   GET|POST /api/retention                   → the daily cron job below.
 *     (Vercel Cron sends GET with a Bearer CRON_SECRET header automatically when
 *     CRON_SECRET is configured — same pattern as ?action=auto-release in
 *     stripe.js.)
 *   POST     /api/retention?action=test-push  → _lib/testPush.js. User-facing
 *     "send me a test notification", authorized by the caller's own minted
 *     Supabase JWT rather than CRON_SECRET. Folded onto this function because
 *     api/ is at Vercel Hobby's 12-function limit (see
 *     src/__tests__/serverlessFunctionBudget.test.js).
 */

import { createClient } from "@supabase/supabase-js";
import { sendEmail, streakRiskTemplate, winBackTemplate } from "./_lib/resend.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return _supabase;
}

/**
 * Verify the request came from Vercel Cron (or a trusted manual trigger) by
 * matching the Bearer token to CRON_SECRET. Same pattern as isCronRequest()
 * in stripe.js. If CRON_SECRET isn't configured, the route is disabled
 * (fails closed) rather than left open.
 */
function isCronRequest(req) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"] || "";
  const cronSecret = process.env.CRON_SECRET;
  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
}

const WIN_BACK_DAY_TOUCHPOINTS = [3, 7, 14];
const MAX_PUSH_PER_RUN = 200; // safety cap; matches the scale of stripe.js's auto-release
const MAX_EMAIL_PER_RUN = 200;

/**
 * Send a push notification for a wallet via the send-push Edge Function.
 * Best-effort — failures are logged, not thrown.
 */
async function sendPushViaEdgeFunction({ walletAddress, title, body, tag, url }) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { sent: false, reason: "not_configured" };
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ wallet_address: walletAddress, title, body, tag, url, category: "activity" }),
    });
    if (!response.ok) return { sent: false, reason: `http_${response.status}` };
    const result = await response.json();
    return { sent: (result.sent || 0) > 0, raw: result };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

function emailOptedIn(prefs) {
  // Defaults to true (see the migration backfill) — only skip if explicitly false.
  return prefs?.retentionEmail !== false;
}

export default async function handler(req, res) {
  // ── Action dispatcher ─────────────────────────────────────────────────────
  // `?action=test-push` is a USER-facing route and must be handled before the
  // cron gate below, which would otherwise 401 it. It carries its own
  // authorization (a verified minted Supabase JWT, so a caller can only target
  // their own wallet) — see _lib/testPush.js.
  //
  // It hangs off this function rather than getting its own `api/*.js` file
  // because `api/` is at Vercel Hobby's 12-function ceiling; a 13th file fails
  // the deploy. `src/__tests__/serverlessFunctionBudget.test.js` pins that, and
  // `api/stripe.js` established this dispatch pattern. Imported dynamically so
  // the daily cron run does not pay `jose`'s cold start.
  if (req.query?.action === "test-push") {
    const { default: handleTestPush } = await import("./_lib/testPush.js");
    return handleTestPush(req, res);
  }

  if (!isCronRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({ error: "Retention job not configured (missing Supabase env vars)" });
  }

  const results = {
    streakRisk: { scanned: 0, pushSent: 0, emailSent: 0, emailSkippedNoAddress: 0, emailSkippedOptOut: 0 },
    winBack: { scanned: 0, pushSent: 0, emailSent: 0, emailSkippedNoAddress: 0, emailSkippedOptOut: 0 },
    errors: [],
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // ── 1. Streak-at-risk: streak active, last action was yesterday (not today) ──
  try {
    const { data: streakRiskUsers, error } = await supabase
      .from("profiles")
      .select("wallet_address, display_name, email, streak_days, notification_preferences")
      .gt("streak_days", 0)
      .eq("last_active_date", yesterdayStr)
      .limit(MAX_PUSH_PER_RUN);

    if (error) throw error;

    for (const user of streakRiskUsers || []) {
      results.streakRisk.scanned++;

      const pushResult = await sendPushViaEdgeFunction({
        walletAddress: user.wallet_address,
        title: `🔥 ${user.streak_days}-day streak at risk`,
        body: "Log a quick care action today to keep your streak alive.",
        tag: "retention-streak-risk",
        url: "/app",
      });
      if (pushResult.sent) results.streakRisk.pushSent++;

      if (!user.email) {
        results.streakRisk.emailSkippedNoAddress++;
      } else if (!emailOptedIn(user.notification_preferences)) {
        results.streakRisk.emailSkippedOptOut++;
      } else {
        const { subject, html } = streakRiskTemplate({
          displayName: user.display_name,
          streakDays: user.streak_days,
        });
        const emailResult = await sendEmail({ to: user.email, subject, html });
        if (emailResult.success) results.streakRisk.emailSent++;
        else results.errors.push(`streak-risk email ${user.wallet_address}: ${emailResult.error}`);
      }
    }
  } catch (err) {
    results.errors.push(`streak-risk query failed: ${err.message}`);
  }

  // ── 2. Inactive win-back: last_active_date exactly N days ago (fixed touchpoints) ──
  try {
    const touchpointDates = WIN_BACK_DAY_TOUCHPOINTS.map(
      (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    );

    const { data: winBackUsers, error } = await supabase
      .from("profiles")
      .select("wallet_address, display_name, email, tank_count, last_active_date, notification_preferences")
      .in("last_active_date", touchpointDates)
      .limit(MAX_EMAIL_PER_RUN);

    if (error) throw error;

    for (const user of winBackUsers || []) {
      results.winBack.scanned++;

      const daysSinceActive = Math.round(
        (Date.now() - new Date(user.last_active_date).getTime()) / (24 * 60 * 60 * 1000)
      );

      const pushResult = await sendPushViaEdgeFunction({
        walletAddress: user.wallet_address,
        title: "🐠 Your tanks miss you",
        body: `It's been ${daysSinceActive} days — come see what's new.`,
        tag: `retention-winback-${daysSinceActive}`,
        url: "/app",
      });
      if (pushResult.sent) results.winBack.pushSent++;

      if (!user.email) {
        results.winBack.emailSkippedNoAddress++;
      } else if (!emailOptedIn(user.notification_preferences)) {
        results.winBack.emailSkippedOptOut++;
      } else {
        const { subject, html } = winBackTemplate({
          displayName: user.display_name,
          daysSinceActive,
          tankCount: user.tank_count || 0,
        });
        const emailResult = await sendEmail({ to: user.email, subject, html });
        if (emailResult.success) results.winBack.emailSent++;
        else results.errors.push(`win-back email ${user.wallet_address}: ${emailResult.error}`);
      }
    }
  } catch (err) {
    results.errors.push(`win-back query failed: ${err.message}`);
  }

  return res.status(200).json({ date: todayStr, ...results });
}
