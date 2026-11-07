// Offline cache. The app shell is cached at install; the tracker files (about 15 MB) are cached the
// first time they are used. Bump VERSION when any file changes so phones pick up the new copy.
const VERSION = "rapetitions-v3";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "src/style.css", "src/app.js", "src/counter.js",
  "src/features.js", "src/modes.js", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The big tracker files never change for a given VERSION: cache first. Everything else (the app
// itself) network first, so a fix reaches the phone on the next open; the cache is the offline copy.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const heavy = url.pathname.includes("/vendor/") || url.pathname.includes("/models/");
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      if (heavy) {
        const hit = await cache.match(e.request);
        if (hit) return hit;
      }
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        throw err;
      }
    }),
  );
});
