/* Poolaris service worker — offline app shell.
   Network-first for same-origin GETs (so updates flow), cache fallback when offline.
   /api/* is never cached; cross-origin (Open-Meteo) always hits the network. */
const CACHE = "poolaris-v4";
const SHELL = [
  "./", "index.html", "styles.css", "manifest.webmanifest", "icon.svg",
  "js/data.js", "js/svg.js", "js/calc.js", "js/charts.js", "js/api.js",
  "js/insights.js", "js/weather.js", "js/chem.js", "js/engage.js",
  "js/activities.js", "js/app.js", "js/portal.js", "pool-knowledge-base.md",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;        // open-meteo etc. → network
  if (url.pathname.startsWith("/api/")) return;       // never cache the API
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match("index.html")))
  );
});

// Tapping a reminder focuses an open tab, or opens the app.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      for (const c of cs) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});

// Best-effort background reminders for an installed PWA (Chromium): periodically
// check the 24/7 engine's alert summary and notify if anything is urgent.
self.addEventListener("periodicsync", (e) => {
  if (e.tag !== "poolaris-alerts") return;
  e.waitUntil(
    fetch("api/alerts/summary", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s && s.ok && s.urgent > 0) {
          return self.registration.showNotification("🏊 Poolaris", {
            body: s.urgent + " urgent pool alert" + (s.urgent === 1 ? "" : "s") + " need attention.",
            tag: "poolaris-periodic", icon: "icon.svg", badge: "icon.svg",
          });
        }
      })
      .catch(() => {})
  );
});
