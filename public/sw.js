const CACHE_NAME = "darinda-fx-v5";

// Immediate Activation on install
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

// 🔔 ULTRA-CLEAN APPLE-STYLE NOTIFICATION DISPATCHER
self.addEventListener("push", (event) => {
  let payload = {
    title: "DARINDA.FX Studio",
    body: "New update in your workspace.",
    url: "/",
    tag: "dfx-studio-alert",
    icon: "/icon-192.png",
    badge: "/icon-192.png"
  };

  if (event.data) {
    try {
      const raw = event.data.json();
      payload = { ...payload, ...raw };
    } catch (e) {
      payload.body = event.data.text() || payload.body;
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/icon-192.png",
    tag: payload.tag || "dfx-notification",
    renotify: true,
    requireInteraction: false,
    vibrate: [120, 60, 120],
    data: {
      url: payload.url || "/",
      timestamp: Date.now()
    },
    actions: [
      { action: "open_portal", title: "⚡ Open Workspace" }
    ]
  };

  if (payload.image) {
    options.image = payload.image;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// 🎯 SEAMLESS APP FOCUS ON TAP
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if ("focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});