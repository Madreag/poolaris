/* Poolaris service worker — offline app shell.
   Network-first for same-origin GETs (so updates flow), cache fallback when offline.
   /api/* is never cached; cross-origin (Open-Meteo) always hits the network. */
const CACHE = "poolaris-v3";
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
