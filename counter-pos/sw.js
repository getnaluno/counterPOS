// Counter POS service worker
// Purpose: satisfy PWA installability requirements and give a basic offline
// fallback for the static shell. It intentionally does NOT cache API/Firebase
// calls or act as the source of truth for data — localStorage/Firestore stay
// in charge of that, exactly as before. Strategy is network-first for the
// app shell so a shop always gets the latest code the moment they're online;
// the cache is only a fallback for when the tablet loses signal mid-shift.
const CACHE_VERSION = "counter-pos-v1";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => {}) // never block install on a flaky first fetch
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never intercept writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave Firebase/CDN calls alone

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
