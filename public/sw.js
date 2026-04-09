// The Good Sort — Service Worker
// Handles push notifications. NO caching — network only.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
      .then(() => {
        // Tell all open tabs to reload so they get fresh code
        return self.clients.matchAll({ type: "window" });
      })
      .then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "SW_UPDATED" }));
      })
  );
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
