/**
 * posthogServer.js — Minimal server-side PostHog capture for Vercel functions.
 *
 * Uses PostHog's plain HTTP capture endpoint (no SDK dependency, same
 * raw-fetch pattern as _lib/mux.js and _lib/resend.js). Only used where an
 * event originates purely server-side (the Stripe webhook, since fiat
 * checkout redirects through Stripe's hosted page and back to a static
 * marketing HTML page rather than the React app bundle where the client-side
 * analytics.js wrapper runs).
 */

const POSTHOG_HOST = process.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

export function isPosthogServerConfigured() {
  return !!process.env.VITE_POSTHOG_KEY;
}

/**
 * Capture a server-side event. Best-effort — never throws.
 *
 * @param {string} distinctId - typically the wallet address
 * @param {string} event - event name
 * @param {object} properties
 */
export async function captureServerEvent(distinctId, event, properties = {}) {
  if (!isPosthogServerConfigured() || !distinctId) return;
  try {
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.VITE_POSTHOG_KEY,
        event,
        distinct_id: distinctId.toLowerCase(),
        properties: { ...properties, $lib: "aquacellum-server" },
      }),
    });
  } catch (err) {
    console.warn(`[PostHog Server] capture(${event}) failed:`, err.message);
  }
}
