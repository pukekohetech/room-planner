/* sw.js - GitHub Pages-friendly offline-first */
const CACHE_VERSION = "v5";
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

// Helper: build URLs relative to the SW scope (e.g. .../room-planner/)
function u(path) {
  return new URL(path, self.registration.scope).toString();
}

// ✅ Add *all* the files your app needs to load offline
const APP_SHELL_URLS = [
  u("./"),
  u("./index.html"),
  u("./manifest.webmanifest"),
  u("./styles.css"),          // if you have it
  u("./common.js"),
  u("./plan.js"),
  u("./walls.js"),
  u("./register-sw.js"),

  // icons (adjust to your real paths/names)
  u("./icons/icon-192.png"),
  u("./icons/icon-512.png"),
  u("./icons/maskable-192.png"),
  u("./icons/maskable-512.png"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(k))
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Navigation: network-first, fallback to cached index.html
async function handleNavigate(request) {
  try {
    const fresh = await fetch(request);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, fresh.clone());
    return fresh;
  } catch {
    // IMPORTANT: use the scoped index.html, not "/index.html"
    return (await caches.match(u("./index.html"))) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only same-origin
  if (url.origin !== self.location.origin) return;

  // SPA/doc navigations
  if (req.mode === "navigate") {
    event.respondWith(handleNavigate(req));
    return;
  }

  // Cache-first for app shell assets
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      // Cache successful basic files
      if (res && res.status === 200 && res.type === "basic") {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      return Response.error();
    }
  })());
});
