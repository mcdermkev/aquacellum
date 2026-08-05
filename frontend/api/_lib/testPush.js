/**
 * testPush.js — handler for `/api/retention?action=test-push`
 *
 * Sends a single push notification to the CALLER'S OWN devices, so a user (or
 * whoever is debugging) can find out whether push actually works instead of
 * guessing.
 *
 * WHY THIS EXISTS. Push had been broken end to end for the entire life of the
 * feature and nobody could tell, because the only feedback the UI ever gave was
 * a toggle switching itself on. There was no way to distinguish "notifications
 * are off", "permission was denied", "this browser never registered", and "the
 * server has no VAPID key". A test send collapses all of that into one
 * observable result, and it is the check that would have caught the outage on
 * day one.
 *
 * WHY IT LIVES IN `_lib/` AND HANGS OFF `retention.js`. Vercel's Hobby plan
 * allows 12 serverless functions per deployment and `api/` is already at exactly
 * 12 — a limit that previously broke a production deploy and is now pinned by
 * `src/__tests__/serverlessFunctionBudget.test.js`. Files under `_lib/` are not
 * routed by Vercel and so cost no function slot; the dispatcher pattern is
 * `api/stripe.js`'s. `retention.js` is the right host: it is the other
 * notification sender, it is cron-only so this adds no load to a hot path, and
 * the Edge Function call it already makes is the same one needed here.
 *
 * ── AUTHORIZATION ──────────────────────────────────────────────────────────
 * The target wallet is read from a *signed claim*, never from the request body.
 * The client sends the Supabase JWT minted by `/api/mint-session`, which is
 * HS256-signed with SUPABASE_JWT_SECRET and carries `wallet_address`. Verifying
 * it here means:
 *   - the caller must already have passed Privy verification to hold the token
 *   - a caller can only ever push to their own wallet
 * Accepting `{ walletAddress }` from the body instead would turn this into an
 * open "send a notification to any user" endpoint.
 */

import { jwtVerify } from "jose";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || "";

/**
 * Best-effort throttle: one test send per wallet per 30s.
 *
 * In-memory, so it only holds within a warm instance and is not a security
 * control — the signed-claim check above is. It exists so a stuck retry loop in
 * the UI cannot fire a burst of notifications at the user.
 */
const RATE_LIMIT_MS = 30_000;
const _lastSend = new Map();

function throttled(wallet) {
  const now = Date.now();
  const previous = _lastSend.get(wallet);
  if (previous && now - previous < RATE_LIMIT_MS) {
    return Math.ceil((RATE_LIMIT_MS - (now - previous)) / 1000);
  }
  _lastSend.set(wallet, now);
  // Keep the map from growing without bound on a long-lived warm instance.
  if (_lastSend.size > 500) {
    for (const [key, at] of _lastSend) {
      if (now - at > RATE_LIMIT_MS) _lastSend.delete(key);
    }
  }
  return 0;
}

/**
 * Verify the minted Supabase JWT and return its wallet claim.
 */
async function walletFromMintedToken(req) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing Authorization header" };
  }
  if (!SUPABASE_JWT_SECRET) {
    // Same failure mode mint-session reports, and for the same reason: without
    // the secret we cannot verify anything, so refuse rather than trust.
    return { ok: false, status: 503, error: "Auth bridge not configured" };
  }

  try {
    const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
    const { payload } = await jwtVerify(authHeader.slice(7), secret);
    const wallet = (payload.wallet_address || "").toLowerCase();

    if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
      return { ok: false, status: 401, error: "Token has no usable wallet claim" };
    }
    return { ok: true, wallet };
  } catch (err) {
    const expired = err?.code === "ERR_JWT_EXPIRED";
    return {
      ok: false,
      status: 401,
      error: expired ? "Session expired — please refresh and try again" : "Invalid session token",
    };
  }
}

export default async function handleTestPush(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: "Push not configured on the server" });
  }

  const auth = await walletFromMintedToken(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const retryAfter = throttled(auth.wallet);
  if (retryAfter > 0) {
    return res
      .status(429)
      .json({ error: `Just sent one — try again in ${retryAfter}s`, retryAfter });
  }

  try {
    // `?force=1` bypasses the user's own category/quiet-hours rules. This button
  // exists to prove the delivery pipeline works, so it must not be silently muted
  // by the very preferences the user is trying to verify — a test that reports
  // "sent 0" because it is 23:00 teaches the wrong lesson about a working setup.
  const response = await fetch(`${SUPABASE_URL}/functions/v1/send-push?force=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        wallet_address: auth.wallet,
        title: "🌊 Notifications are working",
        body: "This is a test from Aquacellum. If you can read this, push is set up correctly.",
        url: "/app/settings",
        category: "activity",
        // Fixed tag so repeated tests replace each other in the tray rather
        // than stacking up.
        tag: "aquadex-test-push",
      }),
    });

    const raw = await response.text();
    let result = {};
    try {
      result = JSON.parse(raw);
    } catch {
      /* non-JSON error body from the Edge Function; surfaced below */
    }

    if (!response.ok) {
      console.error("[test-push] send-push returned", response.status, raw);
      return res.status(502).json({
        error: "The push service rejected the request",
        detail: result.error || `HTTP ${response.status}`,
      });
    }

    const sent = result.sent || 0;

    // `sent: 0` is the single most informative outcome here, and it is NOT an
    // error from send-push's point of view — it means the subscription table has
    // no row for this wallet. That was the production state for every user.
    // Reporting it as a distinct, named result is the point of this endpoint.
    if (sent === 0) {
      return res.status(200).json({
        sent: 0,
        delivered: false,
        reason: "no_devices",
        message:
          "No registered devices for this account. Turn push on in Settings on the device you want notified — if it was already on, toggle it off and on to re-register.",
        failed: result.failed || 0,
        expiredCleaned: result.expired_cleaned || 0,
      });
    }

    return res.status(200).json({
      sent,
      delivered: true,
      failed: result.failed || 0,
      expiredCleaned: result.expired_cleaned || 0,
      message: `Test notification sent to ${sent} device${sent === 1 ? "" : "s"}.`,
    });
  } catch (err) {
    console.error("[test-push] failed:", err);
    return res.status(500).json({ error: err.message });
  }
}
