/**
 * Post-export: inject PWA manifest + icon <link> tags into Expo's generated
 * dist/index.html (Expo's `output: single` export omits them). Run AFTER
 * `expo export --platform web`, from an app directory:  node ../../scripts/patch-pwa.js
 */
const fs = require('fs');
const path = require('path');

const indexPath = path.resolve('dist/index.html');
if (!fs.existsSync(indexPath)) {
  console.error('dist/index.html not found — run expo export first');
  process.exit(1);
}
let html = fs.readFileSync(indexPath, 'utf8');

const tags = [
  '<link rel="manifest" href="/manifest.json" />',
  '<link rel="icon" type="image/png" href="/favicon.png" />',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
].join('\n  ');

if (!html.includes('rel="manifest"')) {
  html = html.replace('</head>', `  ${tags}\n</head>`);
  fs.writeFileSync(indexPath, html);
  console.log('Injected PWA manifest + icon tags into dist/index.html');
} else {
  console.log('PWA tags already present — skipping');
}
