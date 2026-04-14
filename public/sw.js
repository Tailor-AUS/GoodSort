// The Good Sort — Service Worker
// Handles push notifications. NO caching — network only.
// Version changes on each deploy to force SW update.
const SW_VERSION = "20260413-0610";

self.addEventListener("install", () => {
  console.log("[SW] Installing version", SW_VERSION);
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Activating version", SW_VERSION);
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "SW_UPDATED", version: SW_VERSION }));
      })
  );
});

// Intercept ALL fetches — always go to network, never serve from cache
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

// Push notifications
self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || "The Good Sort", {
      body: data.body || "You have a notification",
      icon: "/icon-192.png",
      data: data.url || "/",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data || "/"));
});
