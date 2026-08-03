import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

export interface PickedLocation {
  lat: number;
  lng: number;
  street?: string;
  area?: string;
}

const DEFAULT_LAT = 22.9734; // India geographic center
const DEFAULT_LNG = 78.6569;

export function LocationPicker({
  initial,
  onChange,
}: {
  initial?: PickedLocation;
  onChange: (loc: PickedLocation) => void;
}) {
  if (Platform.OS === 'web') {
    return <WebPicker initial={initial} onChange={onChange} />;
  }
  return <NativePicker initial={initial} onChange={onChange} />;
}

function buildPickerDoc(lat: number, lng: number): string {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{box-sizing:border-box}
html,body{height:100%;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
body{display:flex;flex-direction:column}
#map{flex:1;background:#eef1f4;cursor:crosshair;min-height:0}
#search-wrap{position:relative;padding:8px 10px;background:#fff;border-bottom:1px solid #E5E7EB;z-index:2000;flex-shrink:0}
#search-row{display:flex;align-items:center;gap:8px;background:#F3F4F6;border:1.5px solid #E5E7EB;border-radius:10px;padding:7px 10px;transition:border-color .15s}
#search-row:focus-within{border-color:#3F51D6;background:#fff}
#search-icon{font-size:15px;flex-shrink:0;color:#6B7280}
#search-input{flex:1;border:none;background:transparent;font-size:14px;color:#111827;outline:none;min-width:0}
#search-input::placeholder{color:#9CA3AF}
#search-clear{border:none;background:none;cursor:pointer;font-size:16px;color:#9CA3AF;padding:0 2px;line-height:1;flex-shrink:0;display:none}
#dropdown{position:absolute;top:calc(100% - 4px);left:10px;right:10px;background:#fff;border:1.5px solid #E5E7EB;border-top:none;border-radius:0 0 10px 10px;max-height:220px;overflow-y:auto;z-index:3000;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none}
.dd-item{padding:10px 14px;font-size:13px;color:#111827;cursor:pointer;border-bottom:1px solid #F3F4F6;display:flex;align-items:flex-start;gap:8px;line-height:1.4}
.dd-item:last-child{border-bottom:none}
.dd-item:hover,.dd-item.active{background:#EAECFB}
.dd-pin{flex-shrink:0;font-size:15px;padding-top:1px}
.dd-main{font-weight:600}
.dd-sub{color:#6B7280;font-size:12px;margin-top:2px}
.dd-loading{padding:12px 14px;font-size:13px;color:#6B7280;text-align:center}
.dd-empty{padding:12px 14px;font-size:13px;color:#9CA3AF;text-align:center}
#bar{display:flex;align-items:center;gap:8px;padding:9px 12px;background:rgba(255,255,255,0.97);border-top:1px solid #E5E7EB;z-index:1000;flex-shrink:0}
#addr{flex:1;font-size:13px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* "Use my location" — a round blue control (maps-style) with a white locator dot. */
#gps{position:absolute;right:12px;bottom:70px;width:44px;height:44px;padding:0;border:none;border-radius:50%;background:#1A73E8;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;z-index:1000;display:flex;align-items:center;justify-content:center}
#gps:disabled{opacity:0.55;cursor:default}
#gps .dot{width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-sizing:border-box;position:relative}
#gps .dot::after{content:'';position:absolute;top:50%;left:50%;width:4px;height:4px;border-radius:50%;background:#fff;transform:translate(-50%,-50%)}
#pin-hint{position:absolute;top:58px;left:50%;transform:translateX(-50%);background:rgba(63,81,214,0.9);color:#fff;padding:5px 13px;border-radius:20px;font-size:12px;font-weight:600;z-index:1000;pointer-events:none;white-space:nowrap}
</style>
</head><body>
<div id="search-wrap">
  <div id="search-row">
    <input id="search-input" type="text" placeholder="Search your shop location…" autocomplete="off" spellcheck="false"/>
    <button id="search-clear" onclick="clearSearch()">✕</button>
  </div>
  <div id="dropdown"></div>
</div>
<div id="map"></div>
<div id="pin-hint">Drag pin · tap map to move</div>
<button id="gps" onclick="useGps()" aria-label="My location"><span class="dot"></span></button>
<div id="bar">
  <span id="addr">Locating…</span>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var LAT=${lat}, LNG=${lng};
var map=L.map('map',{zoomControl:true,attributionControl:false});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
map.setView([LAT,LNG],16);
var pinIcon=L.divIcon({html:'<div style="font-size:34px;line-height:1;filter:drop-shadow(0 2px 5px rgba(0,0,0,.45))">📍</div>',className:'',iconSize:[34,34],iconAnchor:[17,34]});
var marker=L.marker([LAT,LNG],{icon:pinIcon,draggable:true}).addTo(map);
function geocode(lat,lng){
  document.getElementById('addr').textContent='Locating…';
  fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat='+lat+'&lon='+lng+'&zoom=18',{headers:{Accept:'application/json'}})
    .then(function(r){return r.json();})
    .then(function(d){
      var a=d.address||{};
      var road=a.road||a.street||a.pedestrian||a.footway||'';
      var suburb=a.suburb||a.neighbourhood||a.quarter||a.village||a.town||'';
      var city=a.city||a.state_district||a.county||'';
      var area=[suburb,city].filter(Boolean).join(', ');
      document.getElementById('addr').textContent=[road,area].filter(Boolean).join(', ')||d.display_name||(lat.toFixed(5)+', '+lng.toFixed(5));
      window.parent&&window.parent.postMessage({type:'pick',lat:lat,lng:lng,street:road,area:area},'*');
    })
    .catch(function(){
      document.getElementById('addr').textContent=lat.toFixed(5)+', '+lng.toFixed(5);
      window.parent&&window.parent.postMessage({type:'pick',lat:lat,lng:lng,street:'',area:''},'*');
    });
}
function emit(lat,lng){marker.setLatLng([lat,lng]);map.panTo([lat,lng]);geocode(lat,lng);}
marker.on('dragend',function(e){var ll=e.target.getLatLng();emit(ll.lat,ll.lng);});
map.on('click',function(e){emit(e.latlng.lat,e.latlng.lng);});
function useGps(){
  var btn=document.getElementById('gps');
  btn.disabled=true;btn.textContent='Locating…';
  navigator.geolocation.getCurrentPosition(
    function(p){btn.disabled=false;btn.textContent='My location';emit(p.coords.latitude,p.coords.longitude);map.setView([p.coords.latitude,p.coords.longitude],17);},
    function(){btn.disabled=false;btn.textContent='My location';document.getElementById('addr').textContent='Location permission denied';},
    {enableHighAccuracy:true,timeout:12000}
  );
}
var searchTimer=null,activeIdx=-1,results=[];
var inp=document.getElementById('search-input');
var drop=document.getElementById('dropdown');
var clearBtn=document.getElementById('search-clear');
inp.addEventListener('input',function(){
  var q=inp.value.trim();
  clearBtn.style.display=q?'block':'none';
  if(!q){closeDrop();return;}
  clearTimeout(searchTimer);
  searchTimer=setTimeout(function(){doSearch(q);},300);
});
inp.addEventListener('keydown',function(e){
  var items=drop.querySelectorAll('.dd-item');
  if(e.key==='ArrowDown'){e.preventDefault();setActive(activeIdx+1,items);}
  else if(e.key==='ArrowUp'){e.preventDefault();setActive(activeIdx-1,items);}
  else if(e.key==='Enter'){e.preventDefault();if(activeIdx>=0&&results[activeIdx])selectResult(results[activeIdx]);}
  else if(e.key==='Escape'){clearSearch();}
});
function setActive(idx,items){
  activeIdx=Math.max(-1,Math.min(idx,items.length-1));
  Array.from(items).forEach(function(el,i){el.classList.toggle('active',i===activeIdx);});
  if(activeIdx>=0)items[activeIdx].scrollIntoView({block:'nearest'});
}
function doSearch(q){
  drop.innerHTML='<div class="dd-loading">Searching…</div>';
  drop.style.display='block';
  fetch('https://nominatim.openstreetmap.org/search?format=json&q='+encodeURIComponent(q)+'&limit=6&addressdetails=1',{headers:{Accept:'application/json'}})
    .then(function(r){return r.json();})
    .then(function(list){
      results=list||[];
      if(!results.length){drop.innerHTML='<div class="dd-empty">No results found</div>';return;}
      activeIdx=-1;
      drop.innerHTML=results.map(function(r,i){
        var a=r.address||{};
        var main=r.name||a.road||a.neighbourhood||r.display_name.split(',')[0]||'';
        var sub=r.display_name.replace(main,'').replace(/^[,\\s]+/,'');
        return '<div class="dd-item" data-idx="'+i+'" onmousedown="pickIdx('+i+')">'
          +'<div><div class="dd-main">'+main+'</div><div class="dd-sub">'+sub+'</div></div>'
          +'</div>';
      }).join('');
    })
    .catch(function(){drop.innerHTML='<div class="dd-empty">Search failed — try again</div>';});
}
function pickIdx(i){if(results[i])selectResult(results[i]);}
function selectResult(r){
  var lat=parseFloat(r.lat),lng=parseFloat(r.lon);
  closeDrop();
  inp.value=r.display_name.split(',').slice(0,2).join(',').trim();
  clearBtn.style.display='block';
  map.setView([lat,lng],17);
  emit(lat,lng);
}
function clearSearch(){inp.value='';clearBtn.style.display='none';closeDrop();inp.focus();}
function closeDrop(){drop.style.display='none';drop.innerHTML='';activeIdx=-1;results=[];}
document.addEventListener('mousedown',function(e){
  if(!document.getElementById('search-wrap').contains(e.target))closeDrop();
});
var hint=document.getElementById('pin-hint');
map.once('click',function(){hint.style.display='none';});
marker.once('drag',function(){hint.style.display='none';});
window.addEventListener('message',function(ev){
  var m=ev.data;
  if(m&&m.type==='setLocation')emit(m.lat,m.lng);
});
// Don't geocode on initial load — only geocode when user explicitly moves the pin or uses GPS
document.getElementById('addr').textContent='Drop pin or use GPS to set location';
window.parent&&window.parent.postMessage({type:'picker-ready'},'*');
</script></body></html>`;
}

function WebPicker({
  initial,
  onChange,
}: {
  initial?: PickedLocation;
  onChange: (loc: PickedLocation) => void;
}) {
  const lat = initial?.lat ?? DEFAULT_LAT;
  const lng = initial?.lng ?? DEFAULT_LNG;
  const doc = useMemo(() => buildPickerDoc(lat, lng), []); // eslint-disable-line react-hooks/exhaustive-deps
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const m = ev.data as { type?: string; lat?: number; lng?: number; street?: string; area?: string };
      if (m?.type === 'pick' && typeof m.lat === 'number' && typeof m.lng === 'number') {
        onChange({ lat: m.lat, lng: m.lng, street: m.street ?? '', area: m.area ?? '' });
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onChange]);

  const Iframe = 'iframe' as unknown as React.ComponentType<Record<string, unknown>>;
  return (
    <View style={styles.mapWrap}>
      <Iframe
        ref={iframeRef}
        srcDoc={doc}
        title="Pin your shop location"
        style={{ border: '0', width: '100%', height: '100%', display: 'block', borderRadius: 10 }}
      />
    </View>
  );
}

function NativePicker({
  initial,
  onChange,
}: {
  initial?: PickedLocation;
  onChange: (loc: PickedLocation) => void;
}) {
  const [locating, setLocating] = useState(false);
  const [picked, setPicked] = useState<PickedLocation | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);

  function useGps() {
    const geo = typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;
    if (!geo) { setError('Location not available on this device.'); return; }
    setLocating(true);
    setError(null);
    geo.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPicked(loc);
        onChange(loc);
        setLocating(false);
      },
      () => {
        setError('Could not get your location. Please allow location access.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  return (
    <View style={styles.nativeWrap}>
      <View style={styles.nativeBox}>
        <Text style={styles.nativeTitle}>Pin your shop on the map</Text>
        <Text style={styles.nativeSub}>
          {picked
            ? `${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}`
            : 'Tap below to use your current GPS location.'}
        </Text>
      </View>
      <Pressable onPress={useGps} disabled={locating} style={[styles.gpsBtn, locating && styles.gpsBtnBusy]}>
        {locating
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.gpsBtnText}>Use my current location</Text>}
      </Pressable>
      {error ? <Text style={styles.errText}>{error}</Text> : null}
      {picked ? <Text style={styles.okText}>Location set</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: {
    width: '100%',
    height: 300,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  nativeWrap: { gap: theme.space.sm },
  nativeBox: {
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.lg,
    alignItems: 'center',
    gap: theme.space.xs,
  },
  nativeTitle: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  nativeSub: { fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center' },
  gpsBtn: {
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsBtnBusy: { opacity: 0.6 },
  gpsBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.body },
  errText: { fontSize: theme.font.small, color: theme.color.danger, textAlign: 'center' },
  okText: { fontSize: theme.font.small, color: theme.color.success, fontWeight: '600', textAlign: 'center' },
});
