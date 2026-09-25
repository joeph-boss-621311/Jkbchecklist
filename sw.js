// JKB Ops service worker — exists only to receive push notifications for the
// daily briefing and open the app when one's tapped. No offline caching.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "JKB Ops", body: "Atlas has something for you." };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) { /* keep default */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "jkb-briefing",
      data: { url: data.url || "app.html" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "app.html", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) if (client.url === url && "focus" in client) return client.focus();
      return self.clients.openWindow(url);
    }),
  );
});
