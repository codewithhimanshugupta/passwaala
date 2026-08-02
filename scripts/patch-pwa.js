/**
 * Post-export: inject PWA manifest + icon links + service-worker registration +
 * Web Push subscription into Expo's generated dist/index.html (Expo's
 * `output: single` export drops the custom web/index.html, so none of this
 * survives otherwise). Run AFTER `expo export --platform web` from an app dir:
 *   node ../../scripts/patch-pwa.js [tokenKey]
 * tokenKey = the localStorage key the app stores its JWT under (so push
 * subscription can auth). Defaults to the shopkeeper key.
 */
const fs = require('fs');
const path = require('path');

const tokenKey = process.argv[2] || 'passwaala.shopkeeper.token';

const indexPath = path.resolve('dist/index.html');
if (!fs.existsSync(indexPath)) {
  console.error('dist/index.html not found — run expo export first');
  process.exit(1);
}
let html = fs.readFileSync(indexPath, 'utf8');

const headTags = `  <link rel="manifest" href="/manifest.json" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />`;

// Registers the SW, then (once a JWT is present) fetches the VAPID key and
// subscribes this browser for Web Push. Retries subscription for a while after
// load so it catches the moment the user logs in (token appears in storage).
const swScript = `  <script>
  (function () {
    if (!('serviceWorker' in navigator)) return;
    var API = ${JSON.stringify(process.env.EXPO_PUBLIC_API_URL || 'https://passwaala.onrender.com')};
    var TOKEN_KEY = ${JSON.stringify(tokenKey)};
    function urlB64ToUint8Array(b64) {
      var pad = '='.repeat((4 - (b64.length % 4)) % 4);
      var base = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
      var raw = atob(base); var arr = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      return arr;
    }
    async function subscribe(reg) {
      try {
        var token = null;
        try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {}
        if (!token) return false;
        if (Notification.permission === 'default') {
          var perm = await Notification.requestPermission();
          if (perm !== 'granted') return false;
        }
        if (Notification.permission !== 'granted') return false;
        var keyRes = await fetch(API + '/push/vapid-key');
        var keyJson = await keyRes.json();
        if (!keyJson.publicKey) return true; // push disabled server-side; stop retrying
        var sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8Array(keyJson.publicKey),
          });
        }
        await fetch(API + '/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(sub),
        });
        return true;
      } catch (e) { return false; }
    }
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).then(function (reg) {
      var tries = 0;
      var timer = setInterval(async function () {
        tries++;
        var done = await subscribe(reg);
        if (done || tries > 40) clearInterval(timer); // ~2 min of retries
      }, 3000);
    }).catch(function () {});
  })();
  </script>`;

let changed = false;
if (!html.includes('rel="manifest"')) {
  html = html.replace('</head>', `${headTags}\n</head>`);
  changed = true;
}
if (!html.includes('serviceWorker')) {
  html = html.replace('</body>', `${swScript}\n</body>`);
  changed = true;
}
if (changed) {
  fs.writeFileSync(indexPath, html);
  console.log('Injected PWA tags + service-worker/push registration into dist/index.html');
} else {
  console.log('PWA + SW already present — skipping');
}
