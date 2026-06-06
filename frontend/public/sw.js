/**
 * Service Worker — Sonar Push Notifications
 * 
 * Handles incoming push events and displays notifications.
 * Registered from the main app when user opts into push.
 */

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
    // Group notifications by category
    renotify: true,
    // Vibrate pattern: short buzz
    vibrate: [100, 50, 100],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || "🌊 Aquacellum", options)
  );
});

// Handle notification click — open the app at the relevant URL
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // If app is already open, focus it and navigate
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
      // Otherwise open a new window
      return clients.openWindow(url);
    })
  );
});

// Handle subscription change (browser rotated keys)
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options).then((subscription) => {
      // POST the new subscription to server
      return fetch("/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
    })
  );
});
