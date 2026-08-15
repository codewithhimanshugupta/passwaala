/**
 * NearBaz customer-app service worker.
 *
 * Strategy:
 *   - Static app shell (JS/CSS/HTML/images under /assets/ and the root HTML)
 *     → cache-first, pre-cached on install, refreshed on activate.
 *   - API requests (URLs containing /api/ or the configured API origin)
 *     → network-only (never cache; auth tokens and fresh data must go direct).
 *   - Everything else (fonts, icons, manifest)
 *     → stale-while-revalidate (serve from cache instantly, refresh in bg).
 *
 * Versioning: bump CACHE_VERSION when deploying a new build so the old shell
 * is evicted and users get fresh code.
 */

const CACHE_VERSION = "v2";
const SHELL_CACHE   = `passwaala-shell-${CACHE_VERSION}`;
const STATIC_CACHE  = `passwaala-static-${CACHE_VERSION}`;

/** These paths are pre-cached on install (the minimal app shell). */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ---------------------------------------------------------------------------
// Install — pre-cache the app shell
// ---------------------------------------------------------------------------

/* ------------------------- Web Push (background alerts) ------------------------- */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "NearBaz";
  const options = {
    body: data.body || "You have a new update.",
    tag: data.tag || "passwaala",
    renotify: true,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    vibrate: [400, 150, 400],
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) { if ("focus" in client) return client.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch((err) => {
        // Some shell URLs might not exist yet in dev — don't block install.
        console.warn('[NearBaz SW] precache partial failure:', err);
      })
    ).then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------------------
// Activate — evict old cache versions
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  const currentCaches = new Set([SHELL_CACHE, STATIC_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !currentCaches.has(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch — route requests
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET (POST/PATCH etc. always go direct).
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip non-http(s) (e.g. chrome-extension://).
  if (!url.protocol.startsWith('http')) return;

  // --- API requests: always network-only ---
  // Matches both relative /api/* paths and any external API origin.
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname !== self.location.hostname
  ) {
    // Let the browser handle it; don't intercept at all.
    return;
  }

  // --- Expo/Metro JS bundles and hashed assets: cache-first ---
  if (
    url.pathname.startsWith('/_expo/') ||
    url.pathname.startsWith('/assets/') ||
    /\.(js|css|woff2?|ttf|otf)(\?.*)?$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // --- Images and icons: stale-while-revalidate ---
  if (/\.(png|jpg|jpeg|webp|gif|svg|ico)(\?.*)?$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // --- HTML (navigation requests / root): cache-first with network fallback ---
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then((r) => r || fetch(request))
      )
    );
    return;
  }

  // --- Default: stale-while-revalidate ---
  event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Serve from cache; on miss fetch and store, then return response. */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

/** Serve from cache immediately; refresh cache in background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache   = await caches.open(cacheName);
  const cached  = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached ?? (await fetchPromise) ?? new Response('Offline', { status: 503 });
}
