const CACHE_NAME = "snaptally-shell-v1";

const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.svg",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

const PRECACHE_SET = new Set(PRECACHE_ASSETS);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Bypass non-GET requests and API endpoints (always use network)
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) {
    return;
  }

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  const isPrecached = PRECACHE_SET.has(url.pathname);
  const isStaticAsset = url.pathname.startsWith("/_astro/") || url.pathname.startsWith("/icons/");

  // Only apply caching strategy to precached assets, navigation, and static bundles
  if (!isPrecached && !isStaticAsset && event.request.mode !== "navigate") {
    return;
  }

  // Cache-first strategy for static app shell assets and navigation
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === "basic"
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          // If offline and navigating, fall back to cached root app shell
          if (event.request.mode === "navigate") {
            const cachedRoot = (await caches.match("/")) || (await caches.match("/index.html"));
            if (cachedRoot) {
              return cachedRoot;
            }
          }
          return new Response("Offline", { status: 503, statusText: "Offline" });
        });
    }),
  );
});
