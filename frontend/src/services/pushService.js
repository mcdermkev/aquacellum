/**
 * pushService.js
 *
 * Client-side Web Push subscription management.
 * Handles: service worker registration, push subscription, and syncing the
 * subscription to Supabase.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE WAS REWRITTEN (2026-07-31)
 *
 * Web Push had never delivered a single notification, and the reason it stayed
 * invisible for so long was in here: `subscribeToPush()` `console.warn`ed a
 * failed Supabase insert and then returned `{ success: true }`. So the UI lit
 * the toggle up over a write that never landed. `push_subscriptions` read 0 rows
 * in production while its unique index had already served 11 scans — attempts
 * were arriving and being rejected, and nothing said so.
 *
 * Three rules now hold:
 *
 *   1. NEVER report success unless a row actually landed. Every failure path
 *      returns `{ success: false, reason }` with a machine-readable reason.
 *   2. NEVER leave the browser and the server disagreeing. If the DB write
 *      fails after `pushManager.subscribe()` succeeded, the browser-side
 *      subscription is rolled back — otherwise the browser holds a live
 *      subscription the server cannot target, `getSubscription()` reports
 *      "subscribed", and the user is stuck in a state no retry escapes.
 *   3. Require the JWT bridge, and say so. The RLS policy on
 *      `push_subscriptions` is `wallet_address = auth.jwt()->>'wallet_address'`
 *      with no `x-wallet-address` fallback (deliberately — see the baseline
 *      migration). Without a minted token the insert is silently denied, so we
 *      check up front and return `not_signed_in` rather than discovering it as
 *      an opaque 42501.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  supabase,
  getCurrentWallet,
  isSupabaseConfigured,
  isFullyAuthenticated,
  getMintedToken,
} from "./supabaseClient";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/**
 * Machine-readable failure reasons. The UI maps these to copy; keep them stable
 * because SonarPreferences switches on them and the tests assert them.
 */
export const PUSH_REASON = {
  UNSUPPORTED: "unsupported",
  IOS_NEEDS_INSTALL: "ios_needs_install",
  NOT_CONFIGURED: "not_configured",
  SUPABASE_NOT_CONFIGURED: "supabase_not_configured",
  NOT_SIGNED_IN: "not_signed_in",
  PERMISSION_DENIED: "permission_denied",
  PERMISSION_DISMISSED: "permission_dismissed",
  OS_PERMISSION_NEEDED: "os_permission_needed",
  PERMISSION_REQUEST_STUCK: "permission_request_stuck",
  NO_PROFILE: "no_profile",
  NOT_AUTHORIZED: "not_authorized",
  STORAGE_FAILED: "storage_failed",
  SUBSCRIBE_FAILED: "subscribe_failed",
  TIMED_OUT: "timed_out",
};

/**
 * Human-readable copy for each reason. Kept beside the codes so a new reason
 * cannot be added without someone deciding what the user is told.
 */
export const PUSH_REASON_MESSAGE = {
  [PUSH_REASON.UNSUPPORTED]: "This browser doesn't support push notifications.",
  [PUSH_REASON.IOS_NEEDS_INSTALL]:
    "On iPhone and iPad, notifications only work once the app is installed to your Home Screen. Use the Install App option in Settings first.",
  [PUSH_REASON.NOT_CONFIGURED]:
    "Push notifications aren't configured on this deployment yet.",
  [PUSH_REASON.SUPABASE_NOT_CONFIGURED]:
    "Notifications need the cloud connection, which isn't configured here.",
  [PUSH_REASON.NOT_SIGNED_IN]:
    "Sign in to enable notifications — we need a verified session to register this device.",
  [PUSH_REASON.PERMISSION_DENIED]:
    "Notifications are blocked. You'll need to allow them in your browser's site settings, since the app can't re-ask once they're blocked.",
  // Covers both "dismissed without choosing" and Chrome's quieter permission
  // UI, where no modal appears and the request resolves straight to "default".
  // In that mode the only way to accept is the bell icon in the address bar, so
  // tapping the button again would loop forever without this hint.
  [PUSH_REASON.PERMISSION_DISMISSED]:
    "No answer was given to the permission request. Tap Turn on notifications again and choose Allow — or if no prompt appears, tap the bell or lock icon in your browser's address bar and allow notifications there.",
  // Installed PWA: there is no address bar to fall back on, so the
  // PERMISSION_DISMISSED advice above is unfollowable. This reason exists purely
  // to give instructions that can actually be carried out.
  [PUSH_REASON.OS_PERMISSION_NEEDED]:
    "No permission prompt appeared. Since the app is installed, notifications also have to be allowed for it at the device level: open your phone's Settings → Apps → Aquacellum → Notifications and turn them on, then come back and try again. Worth checking Do Not Disturb is off too.",
  // The one failure where retrying is guaranteed not to work, so the copy must
  // not suggest it. Only destroying the page context clears a stuck request.
  [PUSH_REASON.PERMISSION_REQUEST_STUCK]:
    "The permission request never got an answer, and the browser won't open a second one until the app is fully restarted. Tapping again won't help. On Android: Settings → Apps → Aquacellum → Force stop, then reopen the app and tap Turn on notifications once. Alternatively, allow notifications for the site in your browser settings and this screen will pick it up on its own.",
  [PUSH_REASON.NO_PROFILE]:
    "Finish setting up your profile first, then enable notifications.",
  [PUSH_REASON.NOT_AUTHORIZED]:
    "Your session wasn't accepted. Try signing out and back in.",
  [PUSH_REASON.STORAGE_FAILED]:
    "We couldn't register this device for notifications. Please try again.",
  [PUSH_REASON.SUBSCRIBE_FAILED]:
    "Your browser couldn't create a push subscription. Please try again.",
  [PUSH_REASON.TIMED_OUT]:
    "This took too long and was stopped. If you didn't see a permission prompt, your browser may be suppressing it — close and reopen the app, then try once more.",
};

/** Copy for a reason code, with a safe fallback for anything unmapped. */
export function pushReasonMessage(reason) {
  return PUSH_REASON_MESSAGE[reason] || "Couldn't enable notifications.";
}

/**
 * Check if Web Push is supported in this browser.
 */
export function isPushSupported() {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** iOS/iPadOS, which gates Web Push on the PWA being installed (16.4+). */
function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

/** Whether the app is running as an installed PWA. */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.navigator.standalone === true
  );
}

/** Rough platform tag, used only to pick the right recovery instructions. */
function isAndroid() {
  return typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
}

/**
 * Which browser engine is actually hosting us.
 *
 * Reported in diagnostics because it materially changes Web Push behaviour and
 * is invisible from inside an installed PWA. On Android the app is a WebAPK
 * backed by whichever browser installed it — Samsung Internet on a Samsung
 * device is entirely plausible, and its notification permission handling is not
 * Chrome's. Diagnosing a permission request that never resolves without knowing
 * which engine is refusing it is guesswork, and this removes the guess.
 *
 * Order matters: Samsung Internet and Edge both include "Chrome" in their UA.
 */
function browserEngine() {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/SamsungBrowser\/(\d+)/.test(ua)) return `Samsung Internet ${RegExp.$1}`;
  if (/EdgA?\/(\d+)/.test(ua)) return `Edge ${RegExp.$1}`;
  if (/OPR\/(\d+)/.test(ua)) return `Opera ${RegExp.$1}`;
  if (/FxiOS|Firefox\/(\d+)/.test(ua)) return `Firefox ${RegExp.$1 || ""}`.trim();
  if (/CriOS\/(\d+)/.test(ua)) return `Chrome iOS ${RegExp.$1}`;
  if (/Chrome\/(\d+)/.test(ua)) return `Chrome ${RegExp.$1}`;
  if (/Safari\//.test(ua)) return "Safari";
  return "unknown";
}

/**
 * iOS Safari in a browser tab can register a service worker and will happily
 * report `PushManager` in window, but `pushManager.subscribe()` rejects until
 * the app is installed to the Home Screen. Detecting it up front turns a
 * confusing generic failure into an actionable instruction.
 */
export function iosNeedsInstall() {
  return isIos() && !isStandalone();
}

/**
 * Get the current push permission state.
 * Returns: 'granted' | 'denied' | 'default' (not asked yet) | 'unsupported'
 */
export function getPushPermission() {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Convert a base64 VAPID public key to a Uint8Array for the subscribe call.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Race a promise against a timeout.
 *
 * WHY EVERY BROWSER CALL BELOW IS WRAPPED. Three of the promises in this file
 * can legitimately never settle, and an unsettled promise here means the
 * Settings button sits on "Working…" forever with no way out but a reload —
 * which is exactly what happened on mobile:
 *
 *   - `navigator.serviceWorker.ready` resolves only when an ACTIVE registration
 *     exists for the scope. This project uses `registerType: 'prompt'` with no
 *     `skipWaiting()`, so on a device that already has a worker the newly
 *     deployed one sits in `waiting` until the user accepts the update prompt.
 *     Any state where nothing reaches `activated` leaves this pending.
 *   - `register()` can hang on a slow or flaky connection.
 *   - `Notification.requestPermission()` does not settle until the user answers,
 *     and mobile Chrome may suppress the prompt entirely after prior dismissals
 *     (its abusive-prompt protection), in which case the answer never comes.
 *
 * A timeout converts all of that into a reported failure the user can act on.
 * Failing loudly on a timer is the whole point of this module.
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(`${label} timed out after ${ms}ms`), { isTimeout: true })),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const SW_READY_TIMEOUT_MS = 10_000;
// 30s, down from 60s. If a prompt is on screen this is ample time to read and
// answer it; if no prompt appeared, a full minute of "Working…" is just a
// slower way of telling the user nothing.
const PERMISSION_TIMEOUT_MS = 30_000;

/**
 * The in-flight `Notification.requestPermission()` promise, if any.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS EXISTS BECAUSE OUR OWN TIMEOUT CREATED A TRAP.
 *
 * A device reported: Chrome 150, installed WebAPK, OS notifications Allowed,
 * service worker active, signed in — and
 *
 *     Last attempt: Notification permission prompt timed out after 30000ms
 *
 * So the promise never settled at all. That matters, because `withTimeout` only
 * abandons OUR wait; it cannot cancel the underlying request, which stays open
 * in the page. Chrome coalesces notification permission requests per page, so
 * once one is outstanding, every subsequent `requestPermission()` call returns a
 * promise that also never settles — no second prompt is shown.
 *
 * The result was a self-perpetuating failure. One stuck request — originally
 * caused by the gesture-ordering bug fixed earlier — poisoned every retry for
 * the entire lifetime of the page context. Retrying could not possibly work, and
 * "try again" was the one instruction guaranteed to fail. Escaping needed the JS
 * context destroyed, which on Android means force-stopping the app, not merely
 * closing and reopening it (that usually resumes from memory).
 *
 * Reusing the same promise means a retry attaches to the existing request rather
 * than issuing a doomed second one, and the permission watcher below gives a
 * second chance to observe the answer even if it arrives after our timeout.
 * ─────────────────────────────────────────────────────────────────────────────
 */
let _pendingPermissionRequest = null;

/** Whether a permission request from an earlier attempt is still unanswered. */
export function hasStuckPermissionRequest() {
  return _pendingPermissionRequest !== null;
}

/**
 * Issue at most ONE outstanding permission request per page context.
 */
function requestPermissionOnce() {
  if (!_pendingPermissionRequest) {
    _pendingPermissionRequest = Promise.resolve(Notification.requestPermission()).finally(
      () => {
        _pendingPermissionRequest = null;
      }
    );
  }
  return _pendingPermissionRequest;
}

/**
 * Watch the notification permission via the Permissions API.
 *
 * `requestPermission()` gives exactly one chance to observe the answer. This
 * gives a second, independent one: it fires if the user answers a prompt after
 * our timeout has already given up, and — the case that actually matters here —
 * if they grant permission in the OS/browser settings instead of in a prompt.
 * Without it, someone who fixes the permission outside the app would come back
 * to a screen still insisting notifications are off.
 *
 * @returns {{ promise: Promise<string>, cancel: () => void }}
 */
function watchPermissionGrant() {
  let cancel = () => {};
  const promise = new Promise((resolve) => {
    if (!navigator.permissions?.query) return; // never resolves; harmless in a race
    navigator.permissions
      .query({ name: "notifications" })
      .then((statusHandle) => {
        const onChange = () => {
          if (statusHandle.state !== "prompt") resolve(statusHandle.state);
        };
        statusHandle.addEventListener?.("change", onChange);
        cancel = () => statusHandle.removeEventListener?.("change", onChange);
      })
      .catch(() => {
        /* Permissions API unavailable or 'notifications' unsupported — fine. */
      });
  });
  return { promise, cancel };
}

/**
 * Ask for notification permission, tolerating every way it can fail to answer.
 *
 * @returns {Promise<string>} the permission state
 * @throws  {Error} with `.isTimeout`, and `.isStuck` when the request that
 *          timed out was left over from an earlier attempt.
 */
async function requestNotificationPermission() {
  if (Notification.permission !== "default") return Notification.permission;

  const alreadyOutstanding = hasStuckPermissionRequest();
  const watcher = watchPermissionGrant();

  try {
    return await withTimeout(
      Promise.race([requestPermissionOnce(), watcher.promise]),
      PERMISSION_TIMEOUT_MS,
      "Notification permission prompt"
    );
  } catch (err) {
    if (err?.isTimeout && (alreadyOutstanding || hasStuckPermissionRequest())) {
      err.isStuck = true;
    }
    throw err;
  } finally {
    watcher.cancel();
  }
}

/**
 * Register the service worker and wait for an active one.
 *
 * Falls back to the existing registration if `ready` times out but a
 * registration object exists: a worker in `waiting` can still receive push
 * events once it activates, so a timeout here is not automatically fatal — but
 * it must not block.
 */
async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers not supported");
  }

  const registration = await withTimeout(
    navigator.serviceWorker.register("/sw.js", { scope: "/" }),
    SW_READY_TIMEOUT_MS,
    "Service worker registration"
  );

  try {
    await withTimeout(navigator.serviceWorker.ready, SW_READY_TIMEOUT_MS, "Service worker activation");
  } catch (err) {
    // Proceed with the registration we already hold. pushManager lives on the
    // registration, not on the active worker, so subscribing still works.
    console.warn("[Push] serviceWorker.ready did not settle; using the registration directly:", err.message);
  }

  return registration;
}

/**
 * Map a PostgREST/Postgres error to a reason code.
 *
 * These three are the ones this table can realistically produce, and each needs
 * different user-facing copy — which is the whole argument against the old
 * `console.warn` and carry on:
 *   42501 — RLS rejected the row. The JWT had no usable `wallet_address` claim.
 *   23503 — FK violation: no `profiles` row for this wallet yet.
 *   42P10 — no unique constraint matching the ON CONFLICT target. Should be
 *           impossible now that the constraint is in a migration, but if the
 *           table is ever recreated by hand this is the symptom, and a generic
 *           "try again" would send someone hunting in the wrong place.
 */
function reasonForDbError(error) {
  switch (error?.code) {
    case "42501":
      return PUSH_REASON.NOT_AUTHORIZED;
    case "23503":
      return PUSH_REASON.NO_PROFILE;
    default:
      return PUSH_REASON.STORAGE_FAILED;
  }
}

/**
 * Roll back a browser-side subscription after a failed server write.
 *
 * Without this the browser keeps a subscription the server has no record of.
 * `getActiveSubscription()` then reports "subscribed", the UI shows push as on,
 * and re-subscribing returns the SAME endpoint from the browser cache — so the
 * user cannot retry their way out. Best-effort: if the rollback itself fails
 * there is nothing further to do, and the reported result is still a failure.
 */
async function rollbackSubscription(subscription) {
  try {
    await subscription?.unsubscribe();
  } catch (err) {
    console.warn("[Push] Rollback of browser subscription failed:", err?.message);
  }
}

/**
 * Subscribe the user to push notifications.
 *
 * Flow:
 *   1. Preflight — all SYNCHRONOUS (see the gesture note below)
 *   2. Request permission, before anything is awaited
 *   3. Register / await the service worker
 *   4. Create push subscription with the VAPID key
 *   5. Store the subscription in Supabase — and roll back step 4 if that fails
 *
 * ⚠️ STEP ORDER IS LOAD-BEARING — DO NOT AWAIT BEFORE STEP 2.
 *
 * `Notification.requestPermission()` must be called while the user activation
 * from the click is still live. Awaiting anything first consumes it, and Chrome
 * on Android then refuses to show the prompt at all: permission stays "default"
 * and the promise never settles.
 *
 * This is exactly how mobile enrolment failed while desktop worked. The old
 * order awaited `ensureServiceWorker()` first, which is fine on desktop Chrome
 * (lenient about activation for this API) and fatal on Android. The device
 * diagnostics showed it precisely — signed in: yes, service worker: active,
 * browser permission: **default** — i.e. every prerequisite met and the prompt
 * simply never happened.
 *
 * Everything in step 1 is therefore synchronous on purpose. If you add a check
 * that needs `await`, it belongs after step 2, not before it.
 *
 * @returns {Promise<{ success: boolean, reason?: string, error?: string }>}
 */
export async function subscribeToPush() {
  // ── 1. Preflight ─────────────────────────────────────────────────────────
  // Every one of these used to be either a bare `false` with a prose string or
  // (worse) not checked at all. Checking them here means the caller gets a
  // reason it can act on before we start mutating browser state.
  if (!isPushSupported()) {
    return { success: false, reason: PUSH_REASON.UNSUPPORTED };
  }

  if (iosNeedsInstall()) {
    return { success: false, reason: PUSH_REASON.IOS_NEEDS_INSTALL };
  }

  if (!VAPID_PUBLIC_KEY) {
    // This was the production failure: VITE_VAPID_PUBLIC_KEY was never set in
    // Vercel, and Vite inlines VITE_* at build time, so the shipped bundle had
    // `undefined` here. Logged loudly because it is a deployment fault, not a
    // user one, and nothing in the UI can resolve it.
    console.error(
      "[Push] VITE_VAPID_PUBLIC_KEY is not set in this build — push cannot work. " +
        "Set it in the Vercel project env and redeploy."
    );
    return { success: false, reason: PUSH_REASON.NOT_CONFIGURED };
  }

  if (!isSupabaseConfigured()) {
    return { success: false, reason: PUSH_REASON.SUPABASE_NOT_CONFIGURED };
  }

  const walletAddress = getCurrentWallet();

  // The RLS policy is JWT-only. In header/anon fallback mode the insert is
  // denied, so there is no point subscribing the browser first.
  if (!walletAddress || !isFullyAuthenticated()) {
    return { success: false, reason: PUSH_REASON.NOT_SIGNED_IN };
  }

  let subscription = null;

  try {
    // ── 2. Request permission — FIRST, while the click's user activation is
    //       still live. See the gesture warning in the docblock above. ───────
    const permission = await requestNotificationPermission();

    if (permission === "denied") {
      return { success: false, reason: PUSH_REASON.PERMISSION_DENIED, detail: "requestPermission → denied" };
    }
    if (permission !== "granted") {
      // Still "default": the prompt was dismissed without a choice, or the
      // browser declined to show it. Distinct from "denied" because it is
      // recoverable by asking again, whereas denied is not.
      //
      // In an installed PWA the recovery differs: there is no address bar, and
      // on Android the installed app also needs OS-level notification
      // permission, which web code can neither read nor request. Route to
      // instructions the user can actually follow.
      return {
        success: false,
        reason: isStandalone()
          ? PUSH_REASON.OS_PERMISSION_NEEDED
          : PUSH_REASON.PERMISSION_DISMISSED,
        // The literal value the API handed back. `undefined` here would mean the
        // browser only supports the legacy callback form of requestPermission,
        // which Promise.race resolves instantly — a completely different fault
        // from a prompt that was dismissed, and indistinguishable without this.
        detail: `requestPermission → ${String(permission)}`,
      };
    }

    // ── 3. Register / await the service worker ─────────────────────────────
    const registration = await ensureServiceWorker();

    // ── 4. Subscribe ───────────────────────────────────────────────────────
    // Reuse an existing browser subscription when there is one: calling
    // subscribe() again with the same applicationServerKey returns the same
    // endpoint anyway, and reusing it keeps the upsert idempotent.
    subscription =
      (await registration.pushManager.getSubscription()) ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));

    // ── 5. Store in Supabase ───────────────────────────────────────────────
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        wallet_address: walletAddress,
        subscription: subscription.toJSON(),
        user_agent: navigator.userAgent,
      },
      { onConflict: "wallet_address,subscription" }
    );

    if (error) {
      // THE BUG THIS REWRITE EXISTS FOR: this used to console.warn and fall
      // through to `return { success: true }`.
      console.error("[Push] Failed to store subscription:", error);
      await rollbackSubscription(subscription);
      return {
        success: false,
        reason: reasonForDbError(error),
        error: error.message,
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[Push] Subscribe failed:", err);
    if (subscription) await rollbackSubscription(subscription);
    // A timeout gets its own reason: "try again" is wrong advice for a prompt
    // that never appeared. And when we are installed, a timeout waiting on the
    // permission prompt is the OS-permission case in practice — Android will not
    // surface Chrome's prompt at all if the WebAPK lacks notification
    // permission, so the generic "reopen the app" line sends the user in circles.
    let reason = PUSH_REASON.SUBSCRIBE_FAILED;
    if (err?.isTimeout) {
      // A request left open by an earlier attempt is the specific case where
      // every retry is doomed, so it gets copy that says so rather than the
      // generic "try again".
      reason = err?.isStuck
        ? PUSH_REASON.PERMISSION_REQUEST_STUCK
        : isStandalone() && Notification.permission !== "granted"
          ? PUSH_REASON.OS_PERMISSION_NEEDED
          : PUSH_REASON.TIMED_OUT;
    }

    return {
      success: false,
      reason,
      error: err?.message,
      // Name plus message: a DOMException like NotAllowedError or
      // AbortError from pushManager.subscribe() points somewhere completely
      // different from a timeout, and the friendly copy erases that difference.
      detail: `${err?.name || "Error"}: ${err?.message || "unknown"}`,
    };
  }
}

/**
 * Unsubscribe from push notifications.
 * Removes the subscription from the browser and from Supabase.
 */
export async function unsubscribeFromPush() {
  if (!isPushSupported()) {
    return { success: false, reason: PUSH_REASON.UNSUPPORTED };
  }

  try {
    const registration = await withTimeout(
      navigator.serviceWorker.ready,
      SW_READY_TIMEOUT_MS,
      "Service worker activation"
    );
    const subscription = await registration.pushManager.getSubscription();

    if (!subscription) return { success: true };

    const endpoint = subscription.endpoint;

    // Delete the server row FIRST. If the browser unsubscribe succeeded but the
    // delete failed, the server would keep pushing to a dead endpoint until
    // send-push's 410 cleanup happened to reap it. This order fails safe: a
    // failed delete leaves a still-valid subscription rather than an orphan.
    const walletAddress = getCurrentWallet();
    if (walletAddress && isSupabaseConfigured()) {
      // Match on the endpoint inside the JSON rather than passing the whole
      // object to `.eq("subscription", ...)`. Whole-jsonb equality depends on
      // key order and exact serialization, so the old filter could match
      // nothing and silently leave the row behind. The endpoint is the stable
      // identity of a subscription.
      const { error } = await supabase
        .from("push_subscriptions")
        .delete()
        .eq("wallet_address", walletAddress)
        .eq("subscription->>endpoint", endpoint);

      if (error) {
        console.error("[Push] Failed to remove stored subscription:", error);
        return {
          success: false,
          reason: reasonForDbError(error),
          error: error.message,
        };
      }
    }

    await subscription.unsubscribe();
    return { success: true };
  } catch (err) {
    console.error("[Push] Unsubscribe failed:", err);
    return { success: false, reason: PUSH_REASON.STORAGE_FAILED, error: err?.message };
  }
}

/**
 * Check if the user currently has an active push subscription in this browser.
 */
export async function getActiveSubscription() {
  if (!isPushSupported()) return null;

  try {
    // Timed out rather than bare: getPushStatus() awaits this on mount, and an
    // unsettled `ready` there is what left the whole panel wedged.
    const registration = await withTimeout(
      navigator.serviceWorker.ready,
      SW_READY_TIMEOUT_MS,
      "Service worker activation"
    );
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * The full, honest push state for this device.
 *
 * Settings previously offered a push toggle with no way to see whether push was
 * actually armed — which is why a total outage looked like a working feature.
 * This is the query behind that display, and it deliberately reports the
 * browser and the server SEPARATELY: `subscribedHere && !registeredOnServer` is
 * the exact divergence the old code could produce, and naming it is what makes
 * it fixable instead of mysterious.
 *
 * @returns {Promise<{
 *   supported: boolean,
 *   configured: boolean,
 *   permission: string,
 *   bridgeActive: boolean,
 *   iosNeedsInstall: boolean,
 *   subscribedHere: boolean,
 *   registeredOnServer: boolean,
 *   deviceCount: number,
 *   blocked: boolean,
 *   active: boolean,
 *   swState: 'none'|'installing'|'waiting'|'active'|'unknown',
 * }>}
 */
export async function getPushStatus() {
  const supported = isPushSupported();
  const permission = getPushPermission();
  const walletAddress = getCurrentWallet();
  const bridgeActive = !!walletAddress && isFullyAuthenticated();

  const status = {
    supported,
    configured: !!VAPID_PUBLIC_KEY,
    permission,
    bridgeActive,
    iosNeedsInstall: iosNeedsInstall(),
    subscribedHere: false,
    registeredOnServer: false,
    deviceCount: 0,
    blocked: permission === "denied",
    active: false,
    swState: "unknown",
    // "installed" vs "browser tab" materially changes what a permission failure
    // means and how it is recovered, so it belongs in the diagnostics.
    displayMode: isStandalone() ? "installed app" : "browser tab",
    platform: isAndroid() ? "android" : isIos() ? "ios" : "other",
    engine: browserEngine(),
  };

  if (!supported) return status;

  // Service worker state, for diagnostics. `waiting` is the interesting one:
  // with registerType 'prompt' a freshly deployed worker sits there until the
  // update prompt is accepted, and that is the state in which `ready` can stall.
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    status.swState = !reg
      ? "none"
      : reg.active
        ? "active"
        : reg.waiting
          ? "waiting"
          : reg.installing
            ? "installing"
            : "unknown";
  } catch {
    status.swState = "unknown";
  }

  const subscription = await getActiveSubscription();
  status.subscribedHere = !!subscription;

  // Only the server can answer "will a notification actually reach me", so the
  // check goes to the table rather than trusting the browser.
  if (bridgeActive && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from("push_subscriptions")
        .select("subscription")
        .eq("wallet_address", walletAddress);

      if (!error && Array.isArray(data)) {
        status.deviceCount = data.length;
        status.registeredOnServer =
          !!subscription &&
          data.some((row) => row?.subscription?.endpoint === subscription.endpoint);
      }
    } catch (err) {
      console.warn("[Push] Could not read stored subscriptions:", err?.message);
    }
  }

  status.active =
    permission === "granted" && status.subscribedHere && status.registeredOnServer;

  return status;
}

/**
 * Ask the server to send a test notification to this account's devices.
 *
 * This is the one action that answers "do notifications actually work" without
 * anyone having to read a log, and it exercises the real delivery path end to
 * end: our API route → the send-push Edge Function → VAPID-signed, encrypted
 * push → the push service → the service worker's `push` handler. Nothing is
 * stubbed, so a success here means a real notification was accepted for
 * delivery.
 *
 * The interesting result is `delivered: false, reason: "no_devices"`: the send
 * succeeded but the account has no rows in `push_subscriptions`. That was the
 * state of every single user in production, and it is the answer the old UI had
 * no way to show.
 *
 * @returns {Promise<{ success: boolean, delivered?: boolean, reason?: string, message?: string }>}
 */
export async function sendTestPush() {
  const token = getMintedToken();

  // The route authorizes off this token's signed wallet claim, so without it
  // there is nothing to send and no point making the request.
  if (!token) {
    return {
      success: false,
      reason: PUSH_REASON.NOT_SIGNED_IN,
      message: pushReasonMessage(PUSH_REASON.NOT_SIGNED_IN),
    };
  }

  try {
    const response = await fetch("/api/retention?action=test-push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        success: false,
        message: body.error || `Test send failed (HTTP ${response.status})`,
        reason: body.reason,
      };
    }

    return {
      success: true,
      delivered: !!body.delivered,
      reason: body.reason,
      message: body.message,
    };
  } catch (err) {
    return { success: false, message: `Test send failed: ${err.message}` };
  }
}

/**
 * Call `cb` whenever the notification permission changes outside our own flow.
 *
 * The recovery instructions for several of the failure reasons above send the
 * user to browser or OS settings. Without this, they would fix the permission
 * there, come back, and find a screen still telling them notifications are off —
 * so the last honest thing the panel does would become the wrong thing.
 *
 * @param {(state: string) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onPermissionChange(cb) {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return () => {};
  }

  let detach = () => {};
  let cancelled = false;

  navigator.permissions
    .query({ name: "notifications" })
    .then((statusHandle) => {
      if (cancelled) return;
      const onChange = () => cb(statusHandle.state);
      statusHandle.addEventListener?.("change", onChange);
      detach = () => statusHandle.removeEventListener?.("change", onChange);
    })
    .catch(() => {
      /* Permissions API or the 'notifications' name unsupported — no watcher. */
    });

  return () => {
    cancelled = true;
    detach();
  };
}
