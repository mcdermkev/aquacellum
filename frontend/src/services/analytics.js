/**
 * analytics.js — PostHog product analytics wrapper.
 *
 * Centralizes PostHog init/identify/capture so the rest of the app never
 * imports posthog-js directly. This keeps analytics optional (no-ops
 * gracefully when VITE_POSTHOG_KEY isn't configured, e.g. in local dev) and
 * gives a single place to add PII scrubbing or event renaming later.
 *
 * Autocapture is left on for pageviews/clicks (PostHog's default), but we
 * layer explicit named events on top for the funnels that actually matter
 * for retention: signup, tank_created, xp_earned, notification_opt_in,
 * marketplace_purchase. Session recording is left off by default — this is
 * an aquarium logbook with tank photos and PII in profile forms, and no
 * flag currently exists in the app to mask sensitive inputs.
 */

import posthog from "posthog-js";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

let _initialized = false;

/**
 * Whether analytics is configured and active.
 */
export function isAnalyticsConfigured() {
  return !!POSTHOG_KEY;
}

/**
 * Initialize PostHog once at app boot. Safe to call multiple times (no-ops
 * after the first successful init). No-ops entirely if VITE_POSTHOG_KEY is
 * unset, so local/dev builds don't send events anywhere.
 */
export function initAnalytics() {
  if (_initialized || !isAnalyticsConfigured()) return;
  try {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      // Respect the same instinct as the rest of the app's beta-safety
      // posture: don't record sessions or mask-by-default surfaces without
      // an explicit opt-in mechanism in place.
      disable_session_recording: true,
      capture_pageview: false, // we call trackPageview() ourselves on route change
      persistence: "localStorage+cookie",
      loaded: () => {
        _initialized = true;
      },
    });
  } catch (err) {
    console.warn("[Analytics] PostHog init failed:", err.message);
  }
}

/**
 * Associate all subsequent events with a wallet address. Call once per
 * login. Uses the wallet address as the distinct_id — it's already the
 * app's canonical user identifier (Supabase profiles.wallet_address).
 */
export function identifyUser(walletAddress, traits = {}) {
  if (!isAnalyticsConfigured() || !walletAddress) return;
  try {
    posthog.identify(walletAddress.toLowerCase(), traits);
  } catch (err) {
    console.warn("[Analytics] identify failed:", err.message);
  }
}

/**
 * Clear the identified user on logout (starts a fresh anonymous session).
 */
export function resetAnalyticsIdentity() {
  if (!isAnalyticsConfigured()) return;
  try {
    posthog.reset();
  } catch {
    // no-op
  }
}

/**
 * Track a named event with optional properties.
 */
export function trackEvent(eventName, properties = {}) {
  if (!isAnalyticsConfigured()) return;
  try {
    posthog.capture(eventName, properties);
  } catch (err) {
    console.warn(`[Analytics] capture(${eventName}) failed:`, err.message);
  }
}

/**
 * Track a pageview for the given path. Called on route change from App.jsx
 * / react-router, since capture_pageview is disabled in init().
 */
export function trackPageview(path) {
  trackEvent("$pageview", { $current_url: path });
}
