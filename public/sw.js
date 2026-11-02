// Service worker for push notifications only: no caching, no offline pages.
// Registered from the "Notify me" modal when a visitor turns notifications on.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Only links on this site; anything else opens the home page.
function sameOriginUrl(value) {
  try {
    const url = new URL(value || "/", self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + "/";
  } catch {
    return self.location.origin + "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Desktop Safari Live";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/icon-192.png",
      data: { url: sameOriginUrl(data.url) },
    }),
  );
});

// Focus a tab that's already on the link, otherwise open it.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = sameOriginUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) {
        if (tab.url === target && "focus" in tab) return tab.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
