// The Good Sort — Service Worker
// Handles push notifications. NO aggressive caching.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  // Clear ALL old caches on activate
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
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

// Network-first for everything — no caching HTML/JS
self.addEventListener("fetch", () => {
  // Let the browser handle all fetches normally
  // No cache interception
  return;
});
