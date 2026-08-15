/**
 * NearbyShopsMap (WEB variant) — the nearby-shops discovery map. Metro loads
 * `NearbyShopsMap.native.tsx` on iOS/Android; this file stays the web version:
 * a self-contained Leaflet iframe with a pin per shop and a user dot, moved
 * verbatim from DiscoveryScreen so web behavior is byte-for-byte unchanged.
 */
import { useEffect, useRef } from 'react';
import type { NearbyShop } from '@passwaala/api-client';
import type { ShopContactFields } from '../types';

export function NearbyShopsMap({ shops, center, selected, onSelect, onRadiusChange }: {
  shops: NearbyShop[];
  center: { lat: number; lng: number };
  selected: NearbyShop | null;
  onSelect: (shop: NearbyShop | null) => void;
  onRadiusChange?: (radius: number) => void;
  /** Delivery radius (metres) — unused on web; the native map draws a circle. */
  radiusMeters?: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const docRef = useRef<string>('');

  // Build a self-contained Leaflet doc with all shop pins.
  // latitude/longitude now come directly from the nearby API response.
  const shopsJson = JSON.stringify(shops.map(s => {
    const sc = s as NearbyShop & ShopContactFields;
    const lat = sc.latitude != null ? Number(sc.latitude) : null;
    const lng = sc.longitude != null ? Number(sc.longitude) : null;
    // Prefer logoUrl (branding icon) then storefrontPhotoUrl for map pins.
    // Skip any URL pointing at the seed /storefront.jpg placeholder that doesn't exist.
    const isUsable = (url?: string | null) =>
      !!url &&
      url.startsWith('http') &&
      !url.includes('/storefront.jpg') &&
      !url.includes('picsum.photos');
    const photo = isUsable(s.logoUrl) ? s.logoUrl! : isUsable(s.storefrontPhotoUrl) ? s.storefrontPhotoUrl : null;
    return { id: s.id, name: s.name, lat, lng, isOpen: s.isOpen, photo };
  }).filter(s => s.lat && s.lng));

  // Memoize the full doc so the iframe never reloads on unrelated re-renders.
  // It only rebuilds when shops or center coords actually change.
  const doc = useRef('');
  const prevKey = useRef('');
  const key = shopsJson + center.lat + center.lng;
  if (prevKey.current !== key) {
    prevKey.current = key;
    doc.current = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
html,body,#map{height:100%;margin:0;padding:0}
.pin-wrap{width:44px;height:44px;border-radius:50%;border:3px solid #0B7A4B;overflow:hidden;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center}
.pin-wrap.active{border-color:#0B7A4B;box-shadow:0 0 0 4px rgba(11,122,75,0.25)}
.pin-wrap.closed{border-color:#999;opacity:0.7}
.pin-img{width:100%;height:100%;object-fit:cover}
.pin-emoji{font-size:22px;line-height:1}
.user-dot{width:18px;height:18px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 3px rgba(37,99,235,0.3)}
</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var shops=${shopsJson};
var map=L.map('map',{zoomControl:true,attributionControl:false});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
L.marker([${center.lat},${center.lng}],{icon:L.divIcon({html:'<div class="user-dot"></div>',className:'',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map);
function makeIcon(s,active){
  var inner=s.photo?'<img class="pin-img" src="'+s.photo+'" onerror="this.style.display=\\'none\\';this.parentNode.innerHTML=\\'<span class=pin-emoji></span>\\'"/>':'<span class="pin-emoji"></span>';
  var cls='pin-wrap'+(active?' active':'')+(s.isOpen?'':' closed');
  return L.divIcon({html:'<div class="'+cls+'">'+inner+'</div>',className:'',iconSize:[44,44],iconAnchor:[22,22]});
}
var markers={};
shops.forEach(function(s){
  if(!s.lat||!s.lng)return;
  var m=L.marker([s.lat,s.lng],{icon:makeIcon(s,false)}).addTo(map);
  m.on('click',function(){window.parent.postMessage({type:'shopClick',id:s.id},'*');});
  markers[s.id]=m;
});
var allLats=[${center.lat}].concat(shops.filter(function(s){return s.lat;}).map(function(s){return s.lat;}));
var allLngs=[${center.lng}].concat(shops.filter(function(s){return s.lng;}).map(function(s){return s.lng;}));
if(allLats.length>1){map.fitBounds([[Math.min.apply(null,allLats),Math.min.apply(null,allLngs)],[Math.max.apply(null,allLats),Math.max.apply(null,allLngs)]],{padding:[48,48],maxZoom:15});}
else{map.setView([${center.lat},${center.lng}],14);}
window.addEventListener('message',function(ev){
  var m=ev.data;
  if(m&&m.type==='selectShop'){Object.keys(markers).forEach(function(id){var s=shops.find(function(x){return x.id===id;});if(s)markers[id].setIcon(makeIcon(s,id===m.id));});}
});
window.parent.postMessage({type:'map-ready'},'*');
// Send current visible radius on every zoom/pan so the app can load more shops.
function sendRadius(){
  var b=map.getBounds();
  var c=map.getCenter();
  var ne=b.getNorthEast();
  var sw=b.getSouthWest();
  // Haversine distance from center to corner (approx radius of visible area).
  var R=6371000;
  var dLat=(ne.lat-sw.lat)*Math.PI/180;
  var dLng=(ne.lng-sw.lng)*Math.PI/180;
  var a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(sw.lat*Math.PI/180)*Math.cos(ne.lat*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
  var radius=Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))/2);
  window.parent.postMessage({type:'radiusChanged',radius:radius},'*');
}
map.on('zoomend moveend',sendRadius);
</script></body></html>`;
  }

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const m = ev.data as { type: string; id?: string; radius?: number };
      if (m.type === 'map-ready') readyRef.current = true;
      if (m.type === 'shopClick' && m.id) {
        const shop = shops.find(s => s.id === m.id);
        onSelect(shop ?? null);
        iframeRef.current?.contentWindow?.postMessage({ type: 'selectShop', id: m.id }, '*');
      }
      if (m.type === 'radiusChanged' && m.radius && m.radius > 0) {
        onRadiusChange?.(m.radius);
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [shops, onSelect, onRadiusChange]);

  useEffect(() => {
    if (selected && readyRef.current) {
      iframeRef.current?.contentWindow?.postMessage({ type: 'selectShop', id: selected.id }, '*');
    }
  }, [selected]);

  const Iframe = 'iframe' as unknown as React.ComponentType<Record<string, unknown>>;
  return (
    <Iframe
      ref={iframeRef}
      srcDoc={doc.current}
      title="Nearby shops map"
      style={{ border: '0', width: '100%', height: 'calc(100dvh - 220px)', minHeight: '380px', display: 'block' }}
    />
  );
}
