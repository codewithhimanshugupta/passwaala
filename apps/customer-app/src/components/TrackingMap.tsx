import { useEffect, useMemo, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { Circle, Path, Rect, Svg } from 'react-native-svg';
import { theme } from '../theme';

/** A lat/lng point. */
export interface Geo {
  lat: number;
  lng: number;
}

/** Which leg of the trip the rider is on. */
export type TripPhase = 'to_shop' | 'to_customer';

/**
 * TrackingMap — live, leg-aware order tracking. No expand/fullscreen — zoom
 * within the inline map only, pan locked to the delivery area.
 *
 * On web: real OpenStreetMap (Leaflet) in an iframe, max-bounds locked to the
 * shop/home/extra-shops bounding box so the user can zoom in but cannot pan
 * outside the delivery area.
 * On native: self-drawn schematic with animated rider dot.
 */
export function TrackingMap({
  shop,
  drop,
  rider,
  phase,
  extraShops = [],
  currentShopIndex = 0,
}: {
  shop: Geo;
  drop: Geo;
  rider?: Geo | null;
  phase: TripPhase;
  extraShops?: Geo[];
  currentShopIndex?: number;
}) {
  if (Platform.OS === 'web') {
    return <WebMap shop={shop} drop={drop} rider={rider} phase={phase} extraShops={extraShops} currentShopIndex={currentShopIndex} />;
  }
  return <SchematicMap shop={shop} drop={drop} rider={rider} phase={phase} extraShops={extraShops} currentShopIndex={currentShopIndex} />;
}

// ─── Leaflet iframe ───────────────────────────────────────────────────────────

function buildDoc(shop: Geo, drop: Geo, rider: Geo | null, phase: TripPhase, extraShops: Geo[], currentShopIndex: number): string {
  const initial = JSON.stringify({ shop, drop, rider: rider ?? null, phase, extraShops, currentShopIndex });

  // Extra shop numbered pins (purple = active, grey = not yet)
  const extraMarkerJs = extraShops.map((_, i) => {
    const num = i + 2;
    const isActive = `D.currentShopIndex === ${i + 1}`;
    return `(function(){
  var es = D.extraShops[${i}];
  var col = (${isActive}) ? '#7C3AED' : '#9CA3AF';
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">'
    + '<path d="M16 0C9.37 0 4 5.37 4 12c0 9 12 28 12 28S28 21 28 12C28 5.37 22.63 0 16 0z" fill="'+col+'" stroke="#fff" stroke-width="1.5"/>'
    + '<text x="16" y="18" text-anchor="middle" font-family="Arial" font-weight="800" font-size="13" fill="#fff">${num}</text>'
    + '</svg>';
  L.marker([es.lat, es.lng], { icon: L.divIcon({ html: svg, className: '', iconSize: [32,40], iconAnchor: [16,40] }) }).addTo(map);
})();`;
  }).join('\n');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#map{height:100%;margin:0;padding:0}#map{background:#eef1f4}.rider-ico{display:block}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var D = ${initial};
var map = L.map('map', { zoomControl: true, attributionControl: false, scrollWheelZoom: true });
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

var SHOP_PIN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">'
  + '<path d="M16 0C9.37 0 4 5.37 4 12c0 9 12 28 12 28S28 21 28 12C28 5.37 22.63 0 16 0z" fill="#0B7A4B" stroke="#fff" stroke-width="1.5"/>'
  + '<path d="M10 14v6h12v-6" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<path d="M8 14l8-6 8 6" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<path d="M14 20v-4h4v4" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>'
  + '</svg>';
var DROP_PIN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">'
  + '<path d="M16 0C9.37 0 4 5.37 4 12c0 9 12 28 12 28S28 21 28 12C28 5.37 22.63 0 16 0z" fill="#2563EB" stroke="#fff" stroke-width="1.5"/>'
  + '<path d="M8 15l8-6 8 6v7a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-7z" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<path d="M13 22v-4h6v4" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>'
  + '</svg>';
var RIDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">'
  + '<rect x="12" y="24" width="20" height="12" rx="6" fill="#1E3A8A"/>'
  + '<rect x="15" y="14" width="14" height="13" rx="3" fill="#E53935"/>'
  + '<path d="M20 18h3a2 2 0 0 1 0 4h-3v-4z" fill="#fff"/>'
  + '<path d="M20 18v6" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>'
  + '<circle cx="22" cy="10" r="7" fill="#1E3A8A"/>'
  + '<circle cx="22" cy="10" r="3.5" fill="#E53935"/>'
  + '<circle cx="13" cy="34" r="4" fill="#0F172A" stroke="#94A3B8" stroke-width="1"/>'
  + '<circle cx="31" cy="34" r="4" fill="#0F172A" stroke="#94A3B8" stroke-width="1"/>'
  + '</svg>';

function riderIcon() { return L.divIcon({ html: RIDER_SVG, className: 'rider-ico', iconSize: [44,44], iconAnchor: [22,22] }); }
L.marker([D.shop.lat, D.shop.lng], { icon: L.divIcon({ html: SHOP_PIN, className: '', iconSize: [32,40], iconAnchor: [16,40] }) }).addTo(map);
L.marker([D.drop.lat, D.drop.lng], { icon: L.divIcon({ html: DROP_PIN, className: '', iconSize: [32,40], iconAnchor: [16,40] }) }).addTo(map);
${extraMarkerJs}

// Lock pan to the bounding box of all fixed points (shops + home), padded 25%.
var ALL_FIXED = [[D.shop.lat, D.shop.lng], [D.drop.lat, D.drop.lng]];
D.extraShops.forEach(function(s) { ALL_FIXED.push([s.lat, s.lng]); });
var MAX_BOUNDS = L.latLngBounds(ALL_FIXED).pad(0.25);
map.setMaxBounds(MAX_BOUNDS);

var phase = D.phase;
var rider = D.rider;
var route = [];
var routeLine = L.polyline([], { color: '#0B7A4B', weight: 5, opacity: 0.85 }).addTo(map);
var riderMarker = null;
var routeSeq = 0;

function fit() {
  var pts = route.slice();
  if (rider) pts.push([rider.lat, rider.lng]);
  if (!pts.length) pts = ALL_FIXED;
  try { map.fitBounds(pts, { padding: [36, 36], minZoom: 12, maxZoom: 17 }); }
  catch(e) { map.setView(pts[0], 14); }
}
function snap(lat, lng) {
  if (route.length < 2) return [lat, lng];
  var best = route[0], bestD = Infinity;
  for (var i = 0; i < route.length; i++) {
    var d = (route[i][0]-lat)*(route[i][0]-lat) + (route[i][1]-lng)*(route[i][1]-lng);
    if (d < bestD) { bestD = d; best = route[i]; }
  }
  return best;
}
function legPoints() {
  if (phase === 'to_shop') { return { from: rider ? rider : D.shop, to: D.shop }; }
  return { from: D.shop, to: D.drop };
}
function computeRoute() {
  var lp = legPoints();
  route = [[lp.from.lat, lp.from.lng], [lp.to.lat, lp.to.lng]];
  routeLine.setLatLngs(route); fit();
  var seq = ++routeSeq;
  fetch('https://router.project-osrm.org/route/v1/driving/' +
    lp.from.lng + ',' + lp.from.lat + ';' + lp.to.lng + ',' + lp.to.lat +
    '?overview=full&geometries=geojson')
    .then(function(r) { return r.json(); })
    .then(function(j) {
      if (seq !== routeSeq) return;
      var c = j && j.routes && j.routes[0] && j.routes[0].geometry && j.routes[0].geometry.coordinates;
      if (!c || !c.length) return;
      route = c.map(function(p) { return [p[1], p[0]]; });
      routeLine.setLatLngs(route); fit();
    })
    .catch(function() {});
}
function placeRider(lat, lng) {
  var pt = phase === 'to_customer' ? snap(lat, lng) : [lat, lng];
  if (!riderMarker) { riderMarker = L.marker([pt[0], pt[1]], { icon: riderIcon(), zIndexOffset: 1000 }).addTo(map); return; }
  var s = riderMarker.getLatLng(), t0 = performance.now(), dur = 1000;
  function step(now) {
    var k = Math.min(1, (now - t0) / dur);
    riderMarker.setLatLng([s.lat + (pt[0] - s.lat) * k, s.lng + (pt[1] - s.lng) * k]);
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function onRider(lat, lng) {
  rider = { lat: lat, lng: lng };
  placeRider(lat, lng);
  if (phase === 'to_shop') computeRoute();
}
computeRoute();
if (rider) placeRider(rider.lat, rider.lng);
window.addEventListener('message', function(ev) {
  var m = ev.data; if (!m) return;
  if (m.type === 'rider' && typeof m.lat === 'number') onRider(m.lat, m.lng);
  else if (m.type === 'phase' && m.phase && m.phase !== phase) { phase = m.phase; computeRoute(); }
});
if (window.parent) window.parent.postMessage({ type: 'map-ready' }, '*');
</script></body></html>`;
}

function WebMap({ shop, drop, rider, phase, extraShops, currentShopIndex }: {
  shop: Geo; drop: Geo; rider?: Geo | null; phase: TripPhase; extraShops: Geo[]; currentShopIndex: number;
}) {
  const doc = useMemo(
    () => buildDoc(shop, drop, rider ?? null, phase, extraShops, currentShopIndex),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    function post() {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      win.postMessage({ type: 'phase', phase }, '*');
      if (rider) win.postMessage({ type: 'rider', lat: rider.lat, lng: rider.lng }, '*');
    }
    function onMsg(ev: MessageEvent) {
      if ((ev.data as { type?: string })?.type === 'map-ready') { readyRef.current = true; post(); }
    }
    window.addEventListener('message', onMsg);
    if (readyRef.current) post();
    return () => window.removeEventListener('message', onMsg);
  }, [rider?.lat, rider?.lng, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const Iframe = 'iframe' as unknown as React.ComponentType<Record<string, unknown>>;
  return (
    <View style={styles.wrap}>
      <View style={styles.webBox}>
        <Iframe ref={iframeRef} srcDoc={doc} title="Live order tracking map"
          style={{ border: '0', width: '100%', height: '100%', display: 'block' }} />
      </View>
      <Text style={styles.caption}>{captionFor(phase, !!rider)}</Text>
    </View>
  );
}

function captionFor(phase: TripPhase, hasRider: boolean): string {
  if (!hasRider) return 'Waiting for your rider to start moving';
  return phase === 'to_shop' ? 'Your rider is heading to the shop' : 'Your rider is on the way to you';
}

// ─── SVG marker components (used by SchematicMap on native) ──────────────────

function ShopPin() {
  return (
    <Svg width={32} height={40} viewBox="0 0 32 40">
      <Path d="M16 0C9.37 0 4 5.37 4 12c0 9 12 28 12 28S28 21 28 12C28 5.37 22.63 0 16 0z" fill="#0B7A4B" stroke="#fff" strokeWidth={1.5} />
      <Path d="M10 17v5h12v-5" fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M8 17l8-6 8 6" fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14 22v-3h4v3" fill="none" stroke="#fff" strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}

function DropPin() {
  return (
    <Svg width={32} height={40} viewBox="0 0 32 40">
      <Path d="M16 0C9.37 0 4 5.37 4 12c0 9 12 28 12 28S28 21 28 12C28 5.37 22.63 0 16 0z" fill="#2563EB" stroke="#fff" strokeWidth={1.5} />
      <Path d="M9 16l7-5 7 5v6a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1v-6z" fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14 23v-3h4v3" fill="none" stroke="#fff" strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}

function ExtraShopPin({ num, active }: { num: number; active: boolean }) {
  return (
    <Svg width={32} height={40} viewBox="0 0 32 40">
      <Path d="M16 0C9.37 0 4 5.37 4 12c0 9 12 28 12 28S28 21 28 12C28 5.37 22.63 0 16 0z"
        fill={active ? '#7C3AED' : '#9CA3AF'} stroke="#fff" strokeWidth={1.5} />
      <Path d={`M16 9 L16 9`} fill="none" />
      {/* number text rendered via a centered circle + font size */}
      <Circle cx={16} cy={14} r={0} fill="none" />
      {/* We can't render text in react-native-svg easily without a font — use a white dot + number approximation */}
      <Rect x={11} y={9} width={10} height={10} rx={2} fill="rgba(255,255,255,0.25)" />
      <Path d={num === 2
        ? 'M13 11h5a2 2 0 0 1 0 4h-5v2h5'
        : num === 3
          ? 'M13 11h5a2 2 0 0 1 0 4h-3m3 0a2 2 0 0 1 0 4h-5'
          : 'M15 11v8m-2-4h4'}
        fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function RiderIcon() {
  return (
    <Svg width={44} height={44} viewBox="0 0 44 44">
      <Rect x={12} y={24} width={20} height={12} rx={6} fill="#1E3A8A" />
      <Rect x={15} y={14} width={14} height={13} rx={3} fill="#E53935" />
      <Path d="M20 18h3a2 2 0 0 1 0 4h-3v-4z" fill="#fff" />
      <Path d="M20 18v6" stroke="#fff" strokeWidth={1.2} strokeLinecap="round" />
      <Circle cx={22} cy={10} r={7} fill="#1E3A8A" />
      <Circle cx={22} cy={10} r={3.5} fill="#E53935" />
      <Circle cx={13} cy={34} r={4} fill="#0F172A" stroke="#94A3B8" strokeWidth={1} />
      <Circle cx={31} cy={34} r={4} fill="#0F172A" stroke="#94A3B8" strokeWidth={1} />
    </Svg>
  );
}

// ─── SchematicMap (native fallback) ──────────────────────────────────────────

function SchematicMap({ shop, drop, rider, phase, extraShops = [], currentShopIndex = 0 }: {
  shop: Geo; drop: Geo; rider?: Geo | null; phase: TripPhase; extraShops?: Geo[]; currentShopIndex?: number;
}) {
  const BOX_W = 300;
  const BOX_H = 170;
  const PAD = 26;

  const allPts = [shop, drop, ...extraShops, ...(rider ? [rider] : [])];
  const minLat = Math.min(...allPts.map((p) => p.lat));
  const maxLat = Math.max(...allPts.map((p) => p.lat));
  const minLng = Math.min(...allPts.map((p) => p.lng));
  const maxLng = Math.max(...allPts.map((p) => p.lng));
  const spanLat = maxLat - minLat || 0.0001;
  const spanLng = maxLng - minLng || 0.0001;

  const project = (p: Geo) => ({
    x: PAD + ((p.lng - minLng) / spanLng) * (BOX_W - 2 * PAD),
    y: PAD + (1 - (p.lat - minLat) / spanLat) * (BOX_H - 2 * PAD),
  });

  const shopPx = project(shop);
  const dropPx = project(drop);
  const extraPx = extraShops.map(project);
  const riderPx = rider ? project(rider) : null;
  const legFrom = phase === 'to_shop' && riderPx ? riderPx : shopPx;
  const legTo = phase === 'to_shop' ? shopPx : dropPx;

  const ax = useRef(new Animated.Value(riderPx?.x ?? shopPx.x)).current;
  const ay = useRef(new Animated.Value(riderPx?.y ?? shopPx.y)).current;
  useEffect(() => {
    if (!riderPx) return;
    Animated.parallel([
      Animated.timing(ax, { toValue: riderPx.x, duration: 1000, useNativeDriver: false }),
      Animated.timing(ay, { toValue: riderPx.y, duration: 1000, useNativeDriver: false }),
    ]).start();
  }, [riderPx?.x, riderPx?.y]); // eslint-disable-line react-hooks/exhaustive-deps

  const DOTS = 12;
  const routeDots = Array.from({ length: DOTS + 1 }, (_, i) => {
    const t = i / DOTS;
    return { x: legFrom.x + (legTo.x - legFrom.x) * t, y: legFrom.y + (legTo.y - legFrom.y) * t };
  });

  return (
    <View style={styles.wrap}>
      <View style={[styles.box, { width: BOX_W, height: BOX_H }]}>
        {routeDots.map((d, i) => (
          <View key={i} style={[styles.routeDot, { left: d.x - 2, top: d.y - 2 }]} />
        ))}
        {extraPx.map((px, i) => (
          <View key={i} style={[styles.pin, { left: px.x - 16, top: px.y - 40 }]}>
            <ExtraShopPin num={i + 2} active={currentShopIndex === i + 1} />
          </View>
        ))}
        <View style={[styles.pin, { left: shopPx.x - 16, top: shopPx.y - 40 }]}><ShopPin /></View>
        <View style={[styles.pin, { left: dropPx.x - 16, top: dropPx.y - 40 }]}><DropPin /></View>
        {riderPx ? (
          <Animated.View style={[styles.rider, { left: Animated.subtract(ax, 22), top: Animated.subtract(ay, 22) }]}>
            <RiderIcon />
          </Animated.View>
        ) : null}
      </View>
      <Text style={styles.caption}>{captionFor(phase, !!rider)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: theme.space.xs },
  box: {
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  webBox: { width: '100%', height: 200 },
  routeDot: { position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: theme.color.borderStrong },
  pin: { position: 'absolute' },
  rider: { position: 'absolute' },
  caption: { fontSize: theme.font.tiny, color: theme.color.textMuted },
});
