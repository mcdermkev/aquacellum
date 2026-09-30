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
 * Screenshots: see the SCREENSHOT_* block below (private bucket, signed upload,
 * signed read link, deleted after 90 days).
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

import { randomUUID } from "node:crypto";
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

// ── Screenshots ────────────────────────────────────────────────────────────
// Stored in the PRIVATE bucket `feedback-screenshots`
// (20261004_storage_owner_policies.sql), which has no browser policies. The
// browser asks for a one-time signed upload (`?action=feedback-upload`), puts
// the file there, and sends back only the object path. The Discord message gets
// a signed read link that expires. Screenshots are deleted after
// SCREENSHOT_RETENTION_DAYS by the daily purge cron (pruneFeedbackScreenshots).
export const SCREENSHOT_BUCKET = "feedback-screenshots";
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
export const SCREENSHOT_TYPES = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
});
export const SCREENSHOT_LINK_SECONDS = 7 * 24 * 60 * 60;
export const SCREENSHOT_RETENTION_DAYS = 90;
const SCREENSHOT_PATH_RE = /^\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp|gif)$/;

/** Only accept object paths this relay itself hands out. */
export function sanitizeScreenshotPath(value) {
  return typeof value === "string" && SCREENSHOT_PATH_RE.test(value) ? value : null;
}

/** `YYYY-MM-DD/<uuid>.<ext>` for a validated content type, or null. */
export function screenshotObjectPath(contentType, { now = new Date(), uuid = randomUUID } = {}) {
  const ext = SCREENSHOT_TYPES[contentType];
  if (!ext) return null;
  return `${now.toISOString().slice(0, 10)}/${uuid()}.${ext}`;
}

/**
 * Validate and normalize the request body.
 * @returns {{ ok: true, value: object } | { ok: false, status: number, error: string }}
 */
export function validateFeedback(body) {
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
      screenshotPath: sanitizeScreenshotPath(body.screenshotPath),
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
          ...(feedback.screenshotLink
            ? [{ name: "Screenshot", value: `[View](${feedback.screenshotLink}) (link expires in 7 days)` }]
            : feedback.screenshotPath
              ? [{ name: "Screenshot", value: `Stored as ${feedback.screenshotPath} (no link could be made)` }]
              : []),
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

/** POST-only, same-site, per-IP limited. Returns false after responding. */
function guard(req, res, bucketKey, rate) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return false;
  }
  const origin = req.headers?.origin;
  if (origin && !ALLOWED_ORIGIN_RE.test(origin)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  const limit = checkRateLimit(`${bucketKey}:${clientIp(req)}`, rate);
  if (!limit.allowed) {
    res.setHeader?.("Retry-After", String(limit.resetIn));
    res.status(429).json({ error: "Too many reports from this connection. Please try again later.", retryAfter: limit.resetIn });
    return false;
  }
  return true;
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    if (body.length > MAX_BODY_BYTES) return { error: { status: 413, error: "Feedback is too large" } };
    try {
      body = JSON.parse(body);
    } catch {
      return { error: { status: 400, error: "Expected a JSON object" } };
    }
  }
  return { body };
}

/** Service-role storage client for the private screenshot bucket, or null. */
async function screenshotStorage(env, supabaseFactory) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || "";
  const key = env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  const make = supabaseFactory || (await import("@supabase/supabase-js")).createClient;
  return make(url, key, { auth: { persistSession: false } }).storage.from(SCREENSHOT_BUCKET);
}

/**
 * `POST /api/retention?action=feedback-upload` with `{ contentType, size }`.
 * Returns `{ path, token }` for a one-time signed upload into the private
 * bucket. The bucket enforces the 5 MB limit and image types server-side too.
 */
export async function handleFeedbackUpload(req, res, { env = process.env, supabaseFactory } = {}) {
  if (!guard(req, res, "feedback-upload", RATE_LIMIT)) return;
  const { body, error } = parseBody(req);
  if (error) return res.status(error.status).json({ error: error.error });

  const contentType = String(body?.contentType || "");
  const size = Number(body?.size);
  if (!SCREENSHOT_TYPES[contentType]) return res.status(400).json({ error: "Screenshots must be PNG, JPEG, WebP or GIF" });
  if (!Number.isFinite(size) || size <= 0 || size > SCREENSHOT_MAX_BYTES) {
    return res.status(413).json({ error: "Screenshots must be under 5 MB" });
  }

  const storage = await screenshotStorage(env, supabaseFactory);
  if (!storage) return res.status(503).json({ error: "Screenshot upload is not configured" });

  const path = screenshotObjectPath(contentType);
  const { data, error: signError } = await storage.createSignedUploadUrl(path);
  if (signError || !data?.token) {
    console.warn("[feedback] signed upload failed:", signError?.message || "no token");
    return res.status(502).json({ error: "Could not prepare the upload" });
  }
  return res.status(200).json({ path, token: data.token });
}

/**
 * Delete screenshots older than SCREENSHOT_RETENTION_DAYS. Folders are dated
 * (YYYY-MM-DD), so whole days are listed and removed. Called by the daily
 * purge cron. Returns { removed, folders, errors }.
 */
export async function pruneFeedbackScreenshots(storage, { now = new Date() } = {}) {
  const out = { removed: 0, folders: 0, errors: [] };
  if (!storage) return out;
  const cutoff = new Date(now.getTime() - SCREENSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: top, error } = await storage.list("", { limit: 1000 });
  if (error) {
    out.errors.push(error.message || String(error));
    return out;
  }
  for (const entry of top || []) {
    const day = entry?.name;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "") || day >= cutoff) continue;
    out.folders++;
    for (let round = 0; round < 50; round++) {
      const { data: files, error: listError } = await storage.list(day, { limit: 100 });
      if (listError) {
        out.errors.push(`${day}: ${listError.message}`);
        break;
      }
      const names = (files || []).filter((f) => f?.id && f.name).map((f) => `${day}/${f.name}`);
      if (names.length === 0) break;
      const { error: removeError } = await storage.remove(names);
      if (removeError) {
        out.errors.push(`${day}: ${removeError.message}`);
        break;
      }
      out.removed += names.length;
      if (names.length < 100) break;
    }
  }
  return out;
}

export default async function handleFeedback(req, res, { env = process.env, fetchImpl = fetch, supabaseFactory } = {}) {
  if (!guard(req, res, "feedback", RATE_LIMIT)) return;
  const { body, error } = parseBody(req);
  if (error) return res.status(error.status).json({ error: error.error });

  const checked = validateFeedback(body);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

  const webhook = feedbackWebhookUrl(env);
  if (!webhook) return res.status(503).json({ error: "Feedback relay is not configured" });

  // A signed read link for the team; the bucket itself stays private.
  if (checked.value.screenshotPath) {
    try {
      const storage = await screenshotStorage(env, supabaseFactory);
      const { data } = storage
        ? await storage.createSignedUrl(checked.value.screenshotPath, SCREENSHOT_LINK_SECONDS)
        : { data: null };
      checked.value.screenshotLink = data?.signedUrl || null;
    } catch (err) {
      console.warn("[feedback] screenshot link failed:", err?.message || "error");
    }
  }

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
