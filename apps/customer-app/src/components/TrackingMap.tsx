import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

/** A lat/lng point. */
export interface Geo {
  lat: number;
  lng: number;
}

/** Which leg of the trip the rider is on. */
export type TripPhase = 'to_shop' | 'to_customer';

/**
 * TrackingMap — live, leg-aware order tracking.
 *
 * On web it renders a REAL OpenStreetMap (Leaflet, no API key) inside an iframe:
 * shop, drop, a road route, and a rider marker that glides to each new
 * GPS position (pushed via postMessage so the map never reloads). The route
 * reflects the current leg: while heading to pickup (`to_shop`) it runs
 * rider→shop and re-computes as the rider moves; after pickup (`to_customer`) it
 * runs shop→drop. On native (no iframe) it degrades to a self-drawn schematic.
 */
export function TrackingMap({
  shop,
  drop,
  rider,
  phase,
  compact = false,
}: {
  shop: Geo;
  drop: Geo;
  rider?: Geo | null;
  phase: TripPhase;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const mapContent = Platform.OS === 'web'
    ? <WebMap shop={shop} drop={drop} rider={rider} phase={phase} expanded={expanded} />
    : <SchematicMap shop={shop} drop={drop} rider={rider} phase={phase} />;

  if (compact && !expanded) {
    return (
      <Pressable onPress={() => setExpanded(true)} style={styles.compactWrap}>
        <View style={styles.compactBox} pointerEvents="none">
          {mapContent}
        </View>
        <View style={styles.expandHint}>
          <Text style={styles.expandHintText}>⤢</Text>
        </View>
      </Pressable>
    );
  }

  if (expanded) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setExpanded(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setExpanded(false)}>
          <Pressable style={styles.modalMapWrap} onPress={() => {}}>
            <WebMap shop={shop} drop={drop} rider={rider} phase={phase} expanded={true} />
            <Pressable style={styles.collapseBtn} onPress={() => setExpanded(false)}>
              <Text style={styles.collapseBtnText}>✕ Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  if (Platform.OS === 'web') {
    return <WebMap shop={shop} drop={drop} rider={rider} phase={phase} expanded={false} />;
  }
  return <SchematicMap shop={shop} drop={drop} rider={rider} phase={phase} />;
}

/** The Leaflet HTML document rendered inside the iframe (self-contained). */
function buildDoc(shop: Geo, drop: Geo, rider: Geo | null, phase: TripPhase): string {
  const initial = JSON.stringify({ shop, drop, rider: rider ?? null, phase });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#map{height:100%;margin:0;padding:0}#map{background:#eef1f4}
.emoji{font-size:22px;line-height:26px;text-align:center;width:26px;height:26px}
.rider-ico svg{display:block}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var D = ${initial};
var map = L.map('map', { zoomControl: false, attributionControl: false });
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
function icon(e){ return L.divIcon({ html: e, className: 'emoji', iconSize: [26,26], iconAnchor: [13,13] }); }
// Top-down PassWaala delivery rider (green body, blue helmet, red delivery box
// with a "P"). Drawn as inline SVG so there's no asset to host.
var RIDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">' +
    '<ellipse cx="22" cy="24" rx="10" ry="15" fill="#1E3A8A"/>' +            /* scooter/legs */
    '<rect x="12" y="14" width="20" height="18" rx="7" fill="#22B14C"/>' +   /* arms/shoulders */
    '<rect x="15" y="24" width="14" height="15" rx="4" fill="#E53935"/>' +   /* delivery box */
    '<text x="22" y="35" text-anchor="middle" font-family="Arial" font-weight="700" font-size="11" fill="#fff">P</text>' +
    '<circle cx="22" cy="14" r="8" fill="#1E3A8A"/>' +                        /* helmet */
    '<circle cx="22" cy="14" r="4.5" fill="#E53935"/>' +                      /* helmet visor dot */
  '</svg>';
function riderIcon(){ return L.divIcon({ html: RIDER_SVG, className: 'rider-ico', iconSize: [44,44], iconAnchor: [22,22] }); }
L.marker([D.shop.lat, D.shop.lng], { icon: icon('<div style="width:20px;height:20px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#0B7A4B;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>') }).addTo(map);
L.marker([D.drop.lat, D.drop.lng], { icon: icon('<div style="width:20px;height:20px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#2563EB;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>') }).addTo(map);

var phase = D.phase;                 // 'to_shop' | 'to_customer'
var rider = D.rider;                 // {lat,lng} | null
var route = [];                      // [lat,lng] polyline along the road
var routeLine = L.polyline([], { color:'#0B7A4B', weight:5, opacity:0.85 }).addTo(map);
var riderMarker = null;
var routeSeq = 0;                    // guards against out-of-order fetch responses

function fit(){
  var pts = route.slice();
  if (rider) pts.push([rider.lat, rider.lng]);
  if (!pts.length) pts = [[D.shop.lat,D.shop.lng],[D.drop.lat,D.drop.lng]];
  try { map.fitBounds(pts, { padding: [36,36], minZoom: 13, maxZoom: 16 }); } catch(e){ map.setView(pts[0], 14); }
}

// Snap a raw point to the nearest vertex on the current route (keeps the marker
// on the road). Falls back to the raw point when no route yet.
function snap(lat, lng){
  if (route.length < 2) return [lat,lng];
  var best = route[0], bestD = Infinity;
  for (var i=0;i<route.length;i++){
    var dLat = route[i][0]-lat, dLng = route[i][1]-lng, d = dLat*dLat + dLng*dLng;
    if (d < bestD){ bestD = d; best = route[i]; }
  }
  return best;
}

// Origin/destination for the CURRENT leg: to_shop = rider→shop (rider if known,
// else shop as a stub); to_customer = shop→drop.
function legPoints(){
  if (phase === 'to_shop'){
    var from = rider ? rider : D.shop;
    return { from: from, to: D.shop };
  }
  return { from: D.shop, to: D.drop };
}

// Fetch the road route for the current leg from OSRM and redraw. Best-effort:
// on any failure we draw a straight segment so the line is never empty.
function computeRoute(){
  var lp = legPoints();
  var straight = [[lp.from.lat, lp.from.lng],[lp.to.lat, lp.to.lng]];
  route = straight; routeLine.setLatLngs(route); fit();
  var seq = ++routeSeq;
  fetch('https://router.project-osrm.org/route/v1/driving/' +
        lp.from.lng + ',' + lp.from.lat + ';' + lp.to.lng + ',' + lp.to.lat +
        '?overview=full&geometries=geojson')
    .then(function(r){ return r.json(); })
    .then(function(j){
      if (seq !== routeSeq) return; // a newer leg/position superseded this
      var c = j && j.routes && j.routes[0] && j.routes[0].geometry && j.routes[0].geometry.coordinates;
      if (!c || !c.length) return;
      route = c.map(function(p){ return [p[1], p[0]]; });
      routeLine.setLatLngs(route); fit();
    })
    .catch(function(){ /* keep straight fallback */ });
}

function placeRider(lat, lng){
  var pt = phase === 'to_customer' ? snap(lat, lng) : [lat, lng];
  var tLat = pt[0], tLng = pt[1];
  if (!riderMarker){ riderMarker = L.marker([tLat,tLng], { icon: riderIcon(), zIndexOffset: 1000 }).addTo(map); return; }
  var s = riderMarker.getLatLng(), t0 = performance.now(), dur = 1000;
  function step(now){ var k = Math.min(1,(now-t0)/dur);
    riderMarker.setLatLng([s.lat+(tLat-s.lat)*k, s.lng+(tLng-s.lng)*k]);
    if (k<1) requestAnimationFrame(step); }
  requestAnimationFrame(step);
}

function onRider(lat, lng){
  rider = { lat: lat, lng: lng };
  placeRider(lat, lng);
  // On the pickup leg the route ORIGIN is the rider, so recompute as they move.
  if (phase === 'to_shop') computeRoute();
}

computeRoute();
if (rider) placeRider(rider.lat, rider.lng);

window.addEventListener('message', function(ev){
  var m = ev.data; if (!m) return;
  if (m.type === 'rider' && typeof m.lat === 'number') onRider(m.lat, m.lng);
  else if (m.type === 'phase' && m.phase && m.phase !== phase){ phase = m.phase; computeRoute(); }
});
if (window.parent) window.parent.postMessage({ type: 'map-ready' }, '*');
</script></body></html>`;
}

function WebMap({ shop, drop, rider, phase, expanded }: { shop: Geo; drop: Geo; rider?: Geo | null; phase: TripPhase; expanded: boolean }) {
  // Build the doc ONCE from the initial props; rider + phase updates go via
  // postMessage so the map (and tiles) never reload.
  const doc = useMemo(() => buildDoc(shop, drop, rider ?? null, phase), []); // eslint-disable-line react-hooks/exhaustive-deps
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);

  // Push rider position + current phase whenever either changes (and on ready).
  useEffect(() => {
    function post() {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      win.postMessage({ type: 'phase', phase }, '*');
      if (rider) win.postMessage({ type: 'rider', lat: rider.lat, lng: rider.lng }, '*');
    }
    function onMsg(ev: MessageEvent) {
      if ((ev.data as { type?: string })?.type === 'map-ready') {
        readyRef.current = true;
        post();
      }
    }
    window.addEventListener('message', onMsg);
    if (readyRef.current) post();
    return () => window.removeEventListener('message', onMsg);
  }, [rider?.lat, rider?.lng, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // react-native-web renders a raw DOM <iframe> via createElement on web.
  const Iframe = 'iframe' as unknown as React.ComponentType<Record<string, unknown>>;
  return (
    <View style={styles.wrap}>
      <View style={[styles.box, styles.webBox, expanded && styles.webBoxExpanded]}>
        <Iframe
          ref={iframeRef}
          srcDoc={doc}
          title="Live order tracking map"
          style={{ border: '0', width: '100%', height: '100%', display: 'block' }}
        />
      </View>
      {!expanded ? <Text style={styles.caption}>{captionFor(phase, !!rider)}</Text> : null}
    </View>
  );
}

/** Human caption under the map for the current leg. */
function captionFor(phase: TripPhase, hasRider: boolean): string {
  if (!hasRider) return 'Waiting for your rider to start moving';
  return phase === 'to_shop' ? 'Your rider is heading to the shop' : 'Your rider is on the way to you';
}

/**
 * SchematicMap — native fallback: a self-drawn box projecting the points, with
 * the rider marker gliding via Animated. Route line reflects the current leg.
 */
function SchematicMap({ shop, drop, rider, phase }: { shop: Geo; drop: Geo; rider?: Geo | null; phase: TripPhase }) {
  const BOX_W = 300;
  const BOX_H = 170;
  const PAD = 26;

  const pts = [shop, drop, ...(rider ? [rider] : [])];
  const minLat = Math.min(...pts.map((p) => p.lat));
  const maxLat = Math.max(...pts.map((p) => p.lat));
  const minLng = Math.min(...pts.map((p) => p.lng));
  const maxLng = Math.max(...pts.map((p) => p.lng));
  const spanLat = maxLat - minLat || 0.0001;
  const spanLng = maxLng - minLng || 0.0001;

  const project = (p: Geo) => ({
    x: PAD + ((p.lng - minLng) / spanLng) * (BOX_W - 2 * PAD),
    y: PAD + (1 - (p.lat - minLat) / spanLat) * (BOX_H - 2 * PAD),
  });

  const shopPx = project(shop);
  const dropPx = project(drop);
  const riderPx = rider ? project(rider) : null;

  // The leg segment: to_shop = rider→shop (if we have the rider), else shop→drop.
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
  }, [riderPx?.x, riderPx?.y, ax, ay, riderPx]);

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
        <View style={[styles.pin, { left: shopPx.x - 12, top: shopPx.y - 12 }]}><View style={styles.shopDot} /></View>
        <View style={[styles.pin, { left: dropPx.x - 12, top: dropPx.y - 12 }]}><View style={styles.dropDot} /></View>
        {riderPx ? (
          <Animated.View style={[styles.rider, { left: Animated.subtract(ax, 13), top: Animated.subtract(ay, 13) }]}>
            <View style={styles.riderDot} />
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
  webBox: { width: '100%', height: 180 },
  webBoxExpanded: { height: 460 },
  // Compact thumbnail (inline, small)
  compactWrap: { position: 'relative', width: 160, height: 130, borderRadius: theme.radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: theme.color.border },
  compactBox: { width: '100%', height: '100%' },
  expandHint: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  expandHintText: { fontSize: 14, color: theme.color.text },
  // Expanded modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 },
  modalMapWrap: { borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.color.surface },
  collapseBtn: { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  collapseBtnText: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  routeDot: { position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: theme.color.borderStrong },
  pin: { position: 'absolute', width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  pinText: { fontSize: 20 },
  shopDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#0B7A4B', borderWidth: 2, borderColor: '#fff' },
  dropDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#2563EB', borderWidth: 2, borderColor: '#fff' },
  rider: { position: 'absolute', width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  riderText: { fontSize: 22 },
  riderDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#E53935', borderWidth: 2, borderColor: '#fff' },
  caption: { fontSize: theme.font.tiny, color: theme.color.textMuted },
});
