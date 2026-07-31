/* global clients, self */
/**
 * sw.js — Aquadex combined service worker (injectManifest source)
 *
 * This single worker does two jobs:
 *   1. PWA app-shell precaching + safe runtime caching (Workbox).
 *   2. Web Push notifications (preserved from the original push worker that
 *      `src/services/pushService.js` registers at `/sw.js`).
 *
 * SAFETY: We deliberately do NOT cache authenticated or mutating traffic.
 *   - /api/* is forced NetworkOnly (auth, relay, checkout, mint-session, etc.).
 *   - Supabase REST reads are NOT cached here (many are user-scoped via JWT);
 *     offline data resilience is handled at the app layer via Dexie/IndexedDB.
 * Only the static, read-only app shell, the FishBase catalog, and images are
 * cached.
 */

import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate, NetworkOnly } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

// ── Precache the built app assets (manifest injected by vite-plugin-pwa) ────
precacheAndRoute(self.__WB_MANIFEST || []);

// ── App-shell navigation fallback ──────────────────────────────────────────
// Serve the SPA shell (/app.html) for any /app/* navigation — including deep
// links like /app/tanks that have no precached HTML of their own — so the app
// works offline and on hard refreshes. Marketing pages keep their own cached
// HTML. /api is never handled as a navigation.
const appShellHandler = createHandlerBoundToURL("/app.html");
registerRoute(
  new NavigationRoute(appShellHandler, {
    allowlist: [/^\/app(\/|$|\?)/],
    denylist: [/^\/api\//],
  })
);

// ── Static read-only data: the FishBase master catalog ─────────────────────
// StaleWhileRevalidate: serve from cache instantly (fast UX) but always
// revalidate in the background so photo-URL updates propagate on next load.
registerRoute(
  ({ url }) => url.pathname === "/fishbase_master.json",
  new StaleWhileRevalidate({
    cacheName: "fishbase-data",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 2, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    ],
  })
);

// ── Images (local /public assets + external species/CDN images) ─────────────
// StaleWhileRevalidate: cached images load instantly, but updated photos
// (e.g. wikimedia replacements) propagate on next visit without manual purge.
registerRoute(
  ({ request }) => request.destination === "image",
  new StaleWhileRevalidate({
    cacheName: "images",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 250, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
);

// ── App JS/CSS/worker chunks: runtime-cached so the precache stays shell-only ─
// The shell (HTML/CSS/icons) is precached; hashed JS chunks are fetched on
// first use and served from cache thereafter. This keeps install-time download
// small while still giving full offline support after the first online visit.
registerRoute(
  ({ request, url, sameOrigin }) =>
    sameOrigin &&
    url.pathname.startsWith("/assets/") &&
    (request.destination === "script" ||
      request.destination === "style" ||
      request.destination === "worker"),
  new StaleWhileRevalidate({
    cacheName: "app-assets",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
);

// ── NEVER cache: authenticated / web3 / mutation endpoints ──────────────────
// Workbox only handles routes we register, so /api/* is already network-only by
// default; this makes the guarantee explicit for auth/relay/checkout paths.
registerRoute(({ url }) => url.pathname.startsWith("/api/"), new NetworkOnly());

// ── Update lifecycle: let the in-app prompt trigger activation ──────────────
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Web Push — preserved verbatim from the original push service worker
// ════════════════════════════════════════════════════════════════════════════

// ── Notification artwork ────────────────────────────────────────────────────
// Both of these MUST be PNG. Android Chrome does not render SVG for notification
// icons or badges, and when the asset fails to load it silently substitutes the
// BROWSER's own icon — which is why every push notification from this app
// displayed a Chrome logo. Every default here used to be `/favicon.svg`.
//
//   NOTIFICATION_ICON — the large artwork. Full colour, opaque background fine.
//   NOTIFICATION_BADGE — the small status-bar glyph. Android uses only the ALPHA
//     channel and tints the result, so this has to be white-on-transparent.
//     icon-192.png cannot serve here: its background is fully opaque, so the mask
//     would be a solid square. See frontend/scripts/generate-notification-badge.mjs.
const NOTIFICATION_ICON = "/icons/icon-192.png";
const NOTIFICATION_BADGE = "/icons/badge-96.png";

/**
 * Accept a sender-supplied icon only when it can actually be fetched and
 * rendered; otherwise fall back to the app icon.
 *
 * Senders in this project have passed two kinds of unusable value, and both
 * produced the same wrong result — the browser's logo:
 *   - emoji, e.g. reef-digest sends "🐙" and echo-nudge "⭐". Those are intended
 *     for the in-app notification list, not as an image URL.
 *   - paths to icons that were never added to the build, e.g.
 *     order-notifications' "/icons/order-new.png".
 *
 * Normalising here means the displayed icon is correct regardless of which
 * sender produced the payload, without needing every Edge Function redeployed in
 * lockstep to get it right.
 */
function resolveNotificationIcon(value) {
  if (typeof value !== "string") return NOTIFICATION_ICON;
  // Must be an absolute URL or a root-relative path — this is what rejects emoji.
  if (!/^(https?:\/\/|\/)/.test(value)) return NOTIFICATION_ICON;
  // SVG is accepted by desktop browsers and ignored by Android; prefer the PNG
  // over a platform-dependent result.
  if (/\.svg(\?|$)/i.test(value)) return NOTIFICATION_ICON;
  return value;
}

// Listen for push events from the server
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "Aquadex",
      body: event.data.text(),
    };
  }

  const options = {
    body: payload.body || "",
    icon: resolveNotificationIcon(payload.icon),
    badge: NOTIFICATION_BADGE,
    tag: payload.tag || "sonar-" + Date.now(),
    data: {
      url: payload.url || "/",
      category: payload.category || "activity",
    },
    renotify: true,
    vibrate: [100, 50, 100],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || "Aquadex", options)
  );
});

// Handle notification click — open/focus the app at the relevant URL
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({
            type: "NOTIFICATION_CLICK",
            url,
            category: event.notification.data?.category,
          });
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});

// Handle subscription change (browser rotated keys)
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options).then((subscription) => {
      return fetch("/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
    })
  );
});
