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

const tokenKey = process.argv[2] || 'nearbaz.shopkeeper.token';

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

// Mobile "fit to screen" hardening, applied to every app's exported HTML:
//  - viewport-fit=cover so the page extends into notch/safe areas (paired with
//    the env(safe-area-inset-*) padding below), and maximum-scale=1 to stop
//    iOS Safari auto-zooming in when a text field is focused.
//  - dynamic viewport height (100dvh) so the app is exactly the VISIBLE height
//    on mobile — plain 100vh includes the retracting address bar and makes the
//    page taller than the screen.
//  - overflow-x:hidden to kill accidental horizontal scroll/side gaps.
// The SafeAreaView RN uses is a no-op on web, so the inset padding lives here.
const fitViewport =
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, shrink-to-fit=no" />';
const fitStyle = `  <style id="pwa-fit">
    html, body { height: 100%; overflow-x: hidden; }
    #root {
      min-height: 100dvh;
      min-height: 100vh; /* fallback for browsers without dvh */
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
      box-sizing: border-box;
    }
  </style>`;

// Registers the SW, then (once a JWT is present) fetches the VAPID key and
// subscribes this browser for Web Push. Retries subscription for a while after
// load so it catches the moment the user logs in (token appears in storage).
const swScript = `  <script>
  (function () {
    if (!('serviceWorker' in navigator)) return;
    var API = ${JSON.stringify(process.env.EXPO_PUBLIC_API_URL || 'https://api.nearbaz.in')};
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

// "Install app" flow (like a native install prompt). On Android/desktop Chrome
// the browser fires `beforeinstallprompt` — we capture it, show a floating
// "Install app" button, and call prompt() on click. On iOS Safari (no such
// event) we show an "Add to Home Screen" hint instead. The button hides itself
// when the app is already installed (running in standalone display mode).
const installLabel = process.env.PWA_INSTALL_LABEL || 'Install app';
const installScript = `  <script>
  (function () {
    // Already installed / launched from home screen → nothing to offer.
    var standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (standalone) return;

    // Show the install invite to anyone who hasn't installed yet. The browser
    // only fires beforeinstallprompt when the app isn't installed, so this is
    // naturally install-gated. To avoid nagging, a dismissal snoozes the invite
    // for a week; after that a non-installer sees it again.
    var SNOOZE_KEY = 'nearbaz.pwa.installSnoozeUntil';
    var SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    try {
      var until = parseInt(localStorage.getItem(SNOOZE_KEY) || '0', 10);
      if (until && Date.now() < until) return;
    } catch (e) {}
    function snooze() { try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch (e) {} }

    var LABEL = ${JSON.stringify(installLabel)};
    var deferred = null;
    var wrap = null;

    function makeBtn(text) {
      // Container holds the install button + a small dismiss (✕) so declining
      // also marks it seen (first-visit-only).
      wrap = document.createElement('div');
      wrap.style.cssText = [
        'position:fixed','left:50%','transform:translateX(-50%)','bottom:20px',
        'z-index:2147483647','display:flex','align-items:center','gap:8px'
      ].join(';');
      var b = document.createElement('button');
      b.textContent = text;
      b.setAttribute('aria-label', text);
      b.style.cssText = [
        'padding:14px 22px','border:none','border-radius:999px',
        'background:#111827','color:#fff','font-size:15px','font-weight:700',
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        'box-shadow:0 6px 20px rgba(0,0,0,0.28)','cursor:pointer'
      ].join(';');
      var x = document.createElement('button');
      x.textContent = '✕';
      x.setAttribute('aria-label', 'Dismiss');
      x.style.cssText = [
        'width:38px','height:38px','border:none','border-radius:999px',
        'background:rgba(17,24,39,0.85)','color:#fff','font-size:15px','font-weight:700',
        'box-shadow:0 6px 20px rgba(0,0,0,0.28)','cursor:pointer'
      ].join(';');
      x.addEventListener('click', function () { snooze(); removeBtn(); });
      wrap.appendChild(b);
      wrap.appendChild(x);
      document.body.appendChild(wrap);
      return b;
    }
    function removeBtn() { if (wrap && wrap.parentNode) { wrap.parentNode.removeChild(wrap); wrap = null; } }

    // Android / desktop Chrome: capture the install prompt and show our button.
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      if (wrap) return;
      var b = makeBtn('📲  ' + LABEL);
      b.addEventListener('click', async function () {
        if (!deferred) return;
        deferred.prompt();
        try { await deferred.userChoice; } catch (e2) {}
        deferred = null;
        snooze();         // acted on it → don't re-show for a week (installed apps are gated anyway)
        removeBtn();
      });
    });

    // Once installed, remove the button. Standalone-mode gating stops it re-showing.
    window.addEventListener('appinstalled', function () { deferred = null; snooze(); removeBtn(); });

    // iOS Safari has no beforeinstallprompt — offer an Add-to-Home-Screen hint.
    var ua = window.navigator.userAgent || '';
    var isIOS = /iphone|ipad|ipod/i.test(ua);
    var isSafari = /^((?!chrome|crios|fxios|android).)*safari/i.test(ua);
    if (isIOS && isSafari) {
      window.addEventListener('load', function () {
        if (wrap || standalone) return;
        var b = makeBtn('📲  ' + LABEL);
        b.addEventListener('click', function () {
          snooze();
          alert('To install: tap the Share button, then "Add to Home Screen".');
        });
      });
    }
  })();
  </script>`;

let changed = false;
if (!html.includes('rel="manifest"')) {
  html = html.replace('</head>', `${headTags}\n</head>`);
  changed = true;
}
// Replace Expo's default viewport meta with the fit-to-screen version
// (viewport-fit=cover + maximum-scale=1) and inject the safe-area/dvh CSS.
if (!html.includes('viewport-fit=cover')) {
  if (/<meta\s+name="viewport"[^>]*>/i.test(html)) {
    html = html.replace(/<meta\s+name="viewport"[^>]*>/i, fitViewport);
  } else {
    html = html.replace('</head>', `  ${fitViewport}\n</head>`);
  }
  changed = true;
}
if (!html.includes('id="pwa-fit"')) {
  html = html.replace('</head>', `${fitStyle}\n</head>`);
  changed = true;
}
if (!html.includes('serviceWorker')) {
  html = html.replace('</body>', `${swScript}\n</body>`);
  changed = true;
}
if (!html.includes('beforeinstallprompt')) {
  html = html.replace('</body>', `${installScript}\n</body>`);
  changed = true;
}
if (changed) {
  fs.writeFileSync(indexPath, html);
  console.log('Injected PWA tags + fit-to-screen viewport/CSS + service-worker/push + install prompt into dist/index.html');
} else {
  console.log('PWA + fit + SW + install prompt already present — skipping');
}
