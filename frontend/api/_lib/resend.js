/**
 * resend.js — Shared Resend email helpers for Vercel serverless functions
 *
 * Centralizes the Resend REST API call (no @resend/node SDK dependency —
 * follows the same raw-fetch pattern as _lib/mux.js) plus the HTML templates
 * used by the retention system (streak-risk nudge, inactivity win-back,
 * weekly digest). Each template returns { subject, html } so callers can
 * plug straight into sendEmail().
 *
 * Requires RESEND_API_KEY (server-side only, no VITE_ prefix) and optionally
 * RESEND_FROM_EMAIL (defaults to notifications@aquacellum.com, which must be
 * a verified sending domain/address in the Resend dashboard).
 */

const RESEND_API_BASE = "https://api.resend.com";

/**
 * Whether Resend credentials are present in the environment.
 */
export function isResendConfigured() {
  return !!process.env.RESEND_API_KEY;
}

/**
 * Send a single email via the Resend REST API.
 *
 * @param {{ to: string, subject: string, html: string, from?: string, replyTo?: string }} params
 * @returns {Promise<{ success: boolean, id?: string, error?: string }>}
 */
export async function sendEmail({ to, subject, html, from, replyTo }) {
  if (!isResendConfigured()) {
    return { success: false, error: "Resend not configured (missing RESEND_API_KEY)" };
  }
  if (!to || !subject || !html) {
    return { success: false, error: "to, subject, and html are required" };
  }

  const fromAddress = from || process.env.RESEND_FROM_EMAIL || "Aquacellum <notifications@aquacellum.com>";

  try {
    const response = await fetch(`${RESEND_API_BASE}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[Resend] Send failed:", response.status, errBody);
      return { success: false, error: `Resend API error (${response.status})` };
    }

    const data = await response.json();
    return { success: true, id: data.id };
  } catch (err) {
    console.error("[Resend] Unexpected error:", err.message);
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared email chrome (header/footer) — keeps templates focused on content
// ─────────────────────────────────────────────────────────────────────────────

const APP_URL = process.env.APP_URL || "https://aquacellum.com";

function wrapEmail(bodyHtml, { previewText = "" } = {}) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;">${previewText}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0e1a;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background-color:#111827;border-radius:16px;overflow:hidden;border:1px solid #1f2937;">
        <tr><td style="padding:24px 32px 8px;">
          <span style="color:#38bdf8;font-size:20px;font-weight:700;">🌊 Aquacellum</span>
        </td></tr>
        <tr><td style="padding:8px 32px 32px;color:#e5e7eb;font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 32px 24px;border-top:1px solid #1f2937;">
          <p style="color:#6b7280;font-size:12px;margin:0 0 8px;">You're receiving this because you have an Aquacellum account.</p>
          <a href="${APP_URL}/app?tab=settings" style="color:#6b7280;font-size:12px;">Manage notification preferences</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function ctaButton(label, href) {
  return `<a href="${href}" style="display:inline-block;margin-top:16px;padding:12px 24px;background-color:#38bdf8;color:#0a0e1a;font-weight:600;text-decoration:none;border-radius:8px;font-size:14px;">${label}</a>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Streak-at-risk nudge — mirrors Echo's in-app whisper tone. Sent when a
 * user's care streak is about to lapse (last action 20+ hours ago).
 */
export function streakRiskTemplate({ displayName, streakDays }) {
  const name = displayName || "there";
  const subject = `🔥 Your ${streakDays}-day streak is about to end`;
  const html = wrapEmail(
    `<p>Hey ${name},</p>
     <p>Echo noticed it's been a while since your last care log. Your <strong>${streakDays}-day streak</strong> is about to reset if you don't log an action today.</p>
     <p>A quick feeding log, water test, or parameter check is all it takes to keep it alive.</p>
     ${ctaButton("Log a care action", `${APP_URL}/app`)}`,
    { previewText: `Your ${streakDays}-day streak is about to end!` }
  );
  return { subject, html };
}

/**
 * Inactivity win-back — sent when a user hasn't opened the app in several days.
 */
export function winBackTemplate({ displayName, daysSinceActive, tankCount }) {
  const name = displayName || "there";
  const subject = "🐠 Your tanks miss you";
  const tankLine = tankCount > 0
    ? `Your ${tankCount} tank${tankCount === 1 ? "" : "s"} are still logged and waiting for an update.`
    : `Your species catalog and marketplace listings are waiting whenever you're ready.`;
  const html = wrapEmail(
    `<p>Hey ${name},</p>
     <p>It's been ${daysSinceActive} days since your last visit to Aquacellum. ${tankLine}</p>
     <p>Poseidon and Echo have been keeping an eye on things — come see what's new.</p>
     ${ctaButton("Open Aquacellum", `${APP_URL}/app`)}`,
    { previewText: "Your tanks miss you — come see what's new." }
  );
  return { subject, html };
}

/**
 * Weekly digest fallback email (mirrors the in-app Poseidon digest content
 * generated by the reef-digest Edge Function, for users who opted into
 * emailDigest: "weekly").
 */
export function weeklyDigestTemplate({ displayName, digestText }) {
  const name = displayName || "there";
  const subject = "🐙 Your Weekly Reef Digest";
  const html = wrapEmail(
    `<p>Hey ${name},</p>
     <p>${digestText}</p>
     ${ctaButton("Visit The Reef", `${APP_URL}/app?tab=reef`)}`,
    { previewText: digestText.slice(0, 100) }
  );
  return { subject, html };
}
