// sw.js
const CACHE_VERSION = "v1.0.0";
const APP_CACHE = `room-planner-${CACHE_VERSION}`;

// IMPORTANT: these are paths relative to the GitHub Pages project root
const APP_SHELL = [
  "/room-planner/",
  "/room-planner/index.html",
  "/room-planner/style.css",
  "/room-planner/common.js",
  "/room-planner/plan.js",
  "/room-planner/walls.js",
  "/room-planner/register-sw.js",
  "/room-planner/manifest.webmanifest",

  // icons (adjust if your filenames differ)
  "/room-planner/icons/icon-192.png",
  "/room-planner/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("room-planner-") && k !== APP_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // 1) Navigations: network-first, fallback to cached index
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(APP_CACHE);
          cache.put("/room-planner/index.html", fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match("/room-planner/index.html");
          return cached || new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // 2) Static assets: cache-first, then network
  event.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;

      const fresh = await fetch(req);
      const cache = await caches.open(APP_CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    })()
  );
});
