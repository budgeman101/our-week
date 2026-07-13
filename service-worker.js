/* Our Week — offline cache (also covers the full Our Kitchen app at ./kitchen/).
   Bump CACHE when you change files so phones pick up the update. */
const CACHE = "our-week-v38";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./maskable-512.png",
  "./kitchen/",
  "./kitchen/index.html",
  "./kitchen/icon-180.png"
];
// CDN files both apps need offline (Firebase SDK, kitchen's font). Cached
// first-come; they're version-pinned so cache-first is safe. Firestore API
// calls are NOT here — sync always goes to the network.
const CDN_HOSTS = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // Cache-first for the pinned CDN files; every other cross-origin request
    // (Firestore sync, the receipt scanner) goes straight to the network.
    if (CDN_HOSTS.includes(url.hostname)) {
      e.respondWith(
        caches.match(req).then(hit => hit || fetch(req).then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
          return res;
        }))
      );
    }
    return;
  }

  // Network-first for the app shell so updates show up; fall back to cache
  // offline — each half of the app falls back to its own page.
  const shell = url.pathname.includes("/kitchen/") ? "./kitchen/index.html" : "./index.html";
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match(shell)))
  );
});

/* ---- push reminders -------------------------------------------------
   The free cloud sender (see REMINDERS-SETUP.md) posts a small JSON
   payload; we just show it. Works even when the app is closed. */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  const title = d.title || "Our Week";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: d.tag || undefined,       // same tag replaces an earlier one instead of stacking
    renotify: !!d.tag,
    data: { url: d.url || "./" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
