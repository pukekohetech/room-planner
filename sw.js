/* sw.js - basic PWA service worker (offline-first for app shell, network-first for navigation) */
const CACHE_VERSION = "v2";
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

// Add your core files here (adjust paths to match your build output)
const APP_SHELL_FILES = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== APP_SHELL_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Helper: respond with cached fallback to index.html for SPA routes (optional)
async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    // If offline, serve cached index.html (good for SPAs). If not SPA, remove this.
    const cached = await caches.match("/index.html");
    return cached || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Ignore non-same-origin requests (or handle if you want)
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first with offline fallback
  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
    return;
  }

  // App-shell files: cache-first
  if (APP_SHELL_FILES.includes(url.pathname) || url.pathname.startsWith("/icons/")) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      return cached || fetch(request);
    })());
    return;
  }

  // Everything else: stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);
    const networkFetch = fetch(request).then((response) => {
      // Cache only successful, basic responses
      if (response && response.status === 200 && response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    }).catch(() => null);

    return cached || (await networkFetch) || Response.error();
  })());
});
