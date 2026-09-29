/**
 * feedbackRelay.js — handler for `POST /api/retention?action=feedback`
 *
 * Relays an in-app feedback report to the team's Discord channel.
 *
 * WHY SERVER-SIDE. FeedbackWidget used to POST straight to a Discord webhook
 * read from VITE_DISCORD_FEEDBACK_WEBHOOK. Vite inlines VITE_* values into the
 * public bundle, so anyone could read the URL and post to (or spam) the channel.
 * The URL now lives only in a server env var:
 *
 *   FEEDBACK_WEBHOOK_URL            preferred
 *   VITE_DISCORD_FEEDBACK_WEBHOOK   fallback, read at runtime only (no client
 *                                   code references it any more, so Vite no
 *                                   longer inlines it). Rename it and rotate the
 *                                   webhook: the old URL was public.
 *
 * Limits: JSON body <= 8 KB, description <= 2000 chars, 5 reports per IP per
 * 10 minutes (in-memory per warm instance, same limiter as the AI routes). Page
 * URLs are reduced to origin + path (query and hash can carry tokens). Mentions
 * are disabled on the Discord message. Nothing about the webhook or Discord's
 * response is returned to the caller.
 *
 * Attribution: if the caller sends their minted Supabase JWT, the verified
 * wallet claim is shown (shortened). A wallet in the body is never trusted.
 */

import { jwtVerify } from "jose";
import { checkRateLimit } from "./rateLimiter.js";

export const FEEDBACK_CATEGORIES = Object.freeze(["bug", "feature", "ux", "other"]);
export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_DESCRIPTION = 2000;
export const RATE_LIMIT = Object.freeze({ maxRequests: 5, windowMs: 10 * 60 * 1000 });

const WEBHOOK_RE = /^https:\/\/(?:discord\.com|discordapp\.com|canary\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/;
const ALLOWED_ORIGIN_RE = /^https:\/\/(?:www\.)?aquacellum\.com$|^https:\/\/[a-z0-9-]+\.vercel\.app$|^http:\/\/localhost(?::\d+)?$/;
const CATEGORY_STYLE = {
  bug: { emoji: "🐛", color: 0xf87171 },
  feature: { emoji: "💡", color: 0x38bdf8 },
  ux: { emoji: "🎨", color: 0xfbbf24 },
  other: { emoji: "💬", color: 0x94a3b8 },
};

export function feedbackWebhookUrl(env = process.env) {
  const url = String(env.FEEDBACK_WEBHOOK_URL || env.VITE_DISCORD_FEEDBACK_WEBHOOK || "").trim();
  return WEBHOOK_RE.test(url) ? url : null;
}

export function clientIp(req) {
  const fwd = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || String(req.headers?.["x-real-ip"] || "").trim() || req.socket?.remoteAddress || "unknown";
}

/** Keep origin + path only; anything unparseable becomes null. */
export function sanitizePageUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const u = new URL(value.slice(0, 500));
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return null;
  }
}

/** Only accept screenshot links into our own Supabase public storage. */
export function sanitizeScreenshotUrl(value, supabaseUrl) {
  if (typeof value !== "string" || !value || !supabaseUrl) return null;
  const prefix = `${String(supabaseUrl).replace(/\/+$/, "")}/storage/v1/object/public/`;
  if (!value.startsWith(prefix) || value.length > 500 || /[\s()<>]/.test(value)) return null;
  return value;
}

/**
 * Validate and normalize the request body.
 * @returns {{ ok: true, value: object } | { ok: false, status: number, error: string }}
 */
export function validateFeedback(body, { supabaseUrl } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Expected a JSON object" };
  }
  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(body), "utf8");
  } catch {
    return { ok: false, status: 400, error: "Unreadable body" };
  }
  if (size > MAX_BODY_BYTES) return { ok: false, status: 413, error: "Feedback is too large" };

  const category = FEEDBACK_CATEGORIES.includes(body.category) ? body.category : "other";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) return { ok: false, status: 400, error: "Please describe the problem or idea" };
  if (description.length > MAX_DESCRIPTION) {
    return { ok: false, status: 413, error: `Please keep it under ${MAX_DESCRIPTION} characters` };
  }
  const screenSize = typeof body.screenSize === "string" && /^\d{1,5}x\d{1,5}$/.test(body.screenSize) ? body.screenSize : null;

  return {
    ok: true,
    value: {
      category,
      description,
      pageUrl: sanitizePageUrl(body.pageUrl),
      screenSize,
      screenshotUrl: sanitizeScreenshotUrl(body.screenshotUrl, supabaseUrl),
    },
  };
}

export function buildDiscordPayload(feedback, { wallet = null, now = new Date() } = {}) {
  const style = CATEGORY_STYLE[feedback.category] || CATEGORY_STYLE.other;
  const who = wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "not signed in";
  return {
    // Never let report text ping @everyone, roles or users.
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `${style.emoji} Feedback: ${feedback.category.toUpperCase()}`,
        description: feedback.description,
        color: style.color,
        fields: [
          { name: "Page", value: feedback.pageUrl || "—", inline: true },
          { name: "Device", value: feedback.screenSize || "—", inline: true },
          ...(feedback.screenshotUrl ? [{ name: "Screenshot", value: `[View](${feedback.screenshotUrl})` }] : []),
        ],
        footer: { text: `Wallet: ${who}` },
        timestamp: now.toISOString(),
      },
    ],
  };
}

async function verifiedWallet(req, secret) {
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  if (!secret || !String(header).startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(String(header).slice(7), new TextEncoder().encode(secret));
    const wallet = String(payload.wallet_address || "").toLowerCase();
    return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null;
  } catch {
    return null; // attribution is optional; a bad token just means "not signed in"
  }
}

export default async function handleFeedback(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const origin = req.headers?.origin;
  if (origin && !ALLOWED_ORIGIN_RE.test(origin)) return res.status(403).json({ error: "Forbidden" });

  const limit = checkRateLimit(`feedback:${clientIp(req)}`, RATE_LIMIT);
  if (!limit.allowed) {
    res.setHeader?.("Retry-After", String(limit.resetIn));
    return res.status(429).json({ error: "Too many reports from this connection. Please try again later.", retryAfter: limit.resetIn });
  }

  let body = req.body;
  if (typeof body === "string") {
    if (body.length > MAX_BODY_BYTES) return res.status(413).json({ error: "Feedback is too large" });
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Expected a JSON object" });
    }
  }

  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || "";
  const checked = validateFeedback(body, { supabaseUrl });
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

  const webhook = feedbackWebhookUrl(env);
  if (!webhook) return res.status(503).json({ error: "Feedback relay is not configured" });

  const wallet = await verifiedWallet(req, env.SUPABASE_JWT_SECRET || "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildDiscordPayload(checked.value, { wallet })),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn("[feedback] relay returned", response.status);
      return res.status(502).json({ error: "Could not deliver feedback" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.warn("[feedback] relay failed:", err?.name || "error");
    return res.status(502).json({ error: "Could not deliver feedback" });
  } finally {
    clearTimeout(timer);
  }
}
