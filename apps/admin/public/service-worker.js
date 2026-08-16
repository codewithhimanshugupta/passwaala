/**
 * NearBaz Admin service worker. Cache-first shell, network-only API,
 * navigation fallback to cached index.html, SWR for images.
 * Bump CACHE_VERSION on each deploy.
 */
const CACHE_VERSION = "v2";
const SHELL_CACHE   = `nearbaz-admin-shell-${CACHE_VERSION}`;
const STATIC_CACHE  = `nearbaz-admin-static-${CACHE_VERSION}`;

const PRECACHE_URLS = ['/', '/index.html', '/favicon.png', '/icons/icon-192.png', '/icons/icon-512.png'];


/* ------------------------- Web Push (background alerts) ------------------------- */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "NearBaz";
  const options = {
    body: data.body || "You have a new update.",
    tag: data.tag || "nearbaz",
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
      cache.addAll(PRECACHE_URLS).catch((err) => console.warn('[Admin SW] precache partial:', err))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const current = new Set([SHELL_CACHE, STATIC_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !current.has(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;
  if (url.pathname.startsWith('/api/') || url.hostname !== self.location.hostname) return;

  if (url.pathname.startsWith('/_expo/') || url.pathname.startsWith('/assets/') || /\.(js|css|woff2?|ttf|otf)(\?.*)?$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }
  if (/\.(png|jpg|jpeg|webp|gif|svg|ico)(\?.*)?$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html').then((r) => r || fetch(request))));
    return;
  }
  event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) { const cache = await caches.open(cacheName); cache.put(request, response.clone()); }
  return response;
}
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => { if (response.ok) cache.put(request, response.clone()); return response; }).catch(() => null);
  return cached ?? (await fetchPromise) ?? new Response('Offline', { status: 503 });
}
