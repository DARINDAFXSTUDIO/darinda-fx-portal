const CACHE_NAME = "darinda-fx-v3";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

// 🔔 ULTRA-CLEAN APPLE/ANDROID NATIVE NOTIFICATION
self.addEventListener("push", (event) => {
  let data = { 
    title: "DARINDA.FX Studio", 
    body: "New project update received.", 
    url: "/" 
  };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: "/icon-192.png",       // Large App Logo
    badge: "/icon-192.png",      // Top status bar icon
    vibrate: [100, 50, 100],
    tag: "dfx-notification",     // Prevents spam duplicate stacking
    renotify: true,
    data: {
      url: data.url || "/"
    },
    actions: [
      { action: "open_app", title: "⚡ Open Workspace" }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ON NOTIFICATION TAP -> FOCUS OR OPEN
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