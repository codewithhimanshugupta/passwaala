/**
 * NearBaz customer-app service worker.
 *
 * IMPORTANT — no request caching. An earlier version cached the app shell
 * (JS/HTML) "cache-first", which pinned returning visitors to a STALE bundle:
 * a deployed bug fix never reached them because the SW kept serving the old
 * cached code (and, in older revisions, a stale index.html). This SW therefore
 * deliberately does NOT intercept fetches — every request goes straight to the
 * network and obeys normal HTTP caching (Vercel serves hashed JS as immutable
 * and index.html as must-revalidate, so fresh code always loads).
 *
 * On activate it PURGES every Cache Storage entry left by the old versions, so
 * any visitor whose browser updates to this SW is immediately un-stuck.
 *
 * The SW is retained only for Web Push (background order alerts).
 */

const SW_VERSION = 'v3-no-cache';

// ---------------------------------------------------------------------------
// Web Push (background alerts) — the only reason this SW still exists.
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'NearBaz';
  const options = {
    body: data.body || 'You have a new update.',
    tag: data.tag || 'nearbaz',
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [400, 150, 400],
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) { if ('focus' in client) return client.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

// ---------------------------------------------------------------------------
// Install — take over immediately (don't wait for old tabs to close).
// ---------------------------------------------------------------------------
self.addEventListener('install', () => {
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate — DELETE every cache the old SW created, then control all clients.
// This is what un-sticks anyone trapped on a stale cached bundle.
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// NOTE: intentionally NO 'fetch' handler. Without it the SW never intercepts
// requests, so the browser always fetches from the network / HTTP cache and can
// never serve a stale bundle. Do not re-add cache-first fetch handling.
