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

// Listen for push events from the server
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "Aquacellum",
      body: event.data.text(),
      icon: "/favicon.svg",
    };
  }

  const options = {
    body: payload.body || "",
    icon: payload.icon || "/favicon.svg",
    badge: "/favicon.svg",
    tag: payload.tag || "sonar-" + Date.now(),
    data: {
      url: payload.url || "/",
      category: payload.category || "activity",
    },
    renotify: true,
    vibrate: [100, 50, 100],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || "🌊 Aquacellum", options)
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
