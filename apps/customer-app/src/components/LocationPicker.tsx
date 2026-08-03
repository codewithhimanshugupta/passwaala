import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';
import type { Strings } from '../i18n/strings';

export interface PickedLocation {
  lat: number;
  lng: number;
  street?: string;
  area?: string;
}

/** India geographic center — neutral default when GPS unavailable */
const DEFAULT_LAT = 22.9734;
const DEFAULT_LNG = 78.6569;

/**
 * LocationPicker — an interactive drop-pin map for choosing delivery coordinates.
 *
 * Web: a Leaflet iframe with a draggable marker. Fires onChange whenever the pin
 * is moved or GPS is used. A "Confirm location" bar shows the resolved address.
 *
 * Native (no iframe): shows a "Use my GPS location" button that reads
 * navigator.geolocation and calls onChange immediately.
 */
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

/* ---------------------------------------------------------------- Web iframe */

/** Localized labels injected into the generated iframe document. */
type PickerLabels = {
  searchPlaceholder: string;
  dragPin: string;
  locating: string;
  myLocation: string;
  permissionDenied: string;
  searching: string;
  noResults: string;
  searchFailed: string;
};

/** JSON-encode a label for safe embedding into the iframe's inline script. */
function js(str: string): string {
  return JSON.stringify(str);
}

function buildPickerDoc(lat: number, lng: number, L10n: PickerLabels): string {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{box-sizing:border-box}
html,body{height:100%;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
body{display:flex;flex-direction:column}
#map{flex:1;background:#eef1f4;cursor:crosshair;min-height:0}

/* ── Search bar ── */
#search-wrap{position:relative;padding:8px 10px;background:#fff;border-bottom:1px solid #E5E7EB;z-index:2000;flex-shrink:0}
#search-row{display:flex;align-items:center;gap:8px;background:#F3F4F6;border:1.5px solid #E5E7EB;border-radius:10px;padding:7px 10px;transition:border-color .15s}
#search-row:focus-within{border-color:#0B7A4B;background:#fff}
#search-icon{font-size:15px;flex-shrink:0;color:#6B7280}
#search-input{flex:1;border:none;background:transparent;font-size:14px;color:#111827;outline:none;min-width:0}
#search-input::placeholder{color:#9CA3AF}
#search-clear{border:none;background:none;cursor:pointer;font-size:16px;color:#9CA3AF;padding:0 2px;line-height:1;flex-shrink:0;display:none}

/* ── Dropdown ── */
#dropdown{position:absolute;top:calc(100% - 4px);left:10px;right:10px;background:#fff;border:1.5px solid #E5E7EB;border-top:none;border-radius:0 0 10px 10px;max-height:220px;overflow-y:auto;z-index:3000;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none}
.dd-item{padding:10px 14px;font-size:13px;color:#111827;cursor:pointer;border-bottom:1px solid #F3F4F6;display:flex;align-items:flex-start;gap:8px;line-height:1.4}
.dd-item:last-child{border-bottom:none}
.dd-item:hover,.dd-item.active{background:#F0FDF4}
.dd-pin{flex-shrink:0;font-size:15px;padding-top:1px}
.dd-main{font-weight:600}
.dd-sub{color:#6B7280;font-size:12px;margin-top:2px}
.dd-loading{padding:12px 14px;font-size:13px;color:#6B7280;text-align:center}
.dd-empty{padding:12px 14px;font-size:13px;color:#9CA3AF;text-align:center}

/* ── Bottom bar ── */
#bar{display:flex;align-items:center;gap:8px;padding:9px 12px;background:rgba(255,255,255,0.97);border-top:1px solid #E5E7EB;z-index:1000;flex-shrink:0}
#addr{flex:1;font-size:13px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* "Use my location" — a round blue control (maps-style) with a white locator
   dot ring drawn in CSS. Floats above the map, bottom-right. */
#gps{position:absolute;right:12px;bottom:70px;width:44px;height:44px;padding:0;border:none;border-radius:50%;background:#1A73E8;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;z-index:1000;display:flex;align-items:center;justify-content:center}
#gps:disabled{opacity:0.55;cursor:default}
#gps .dot{width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-sizing:border-box;position:relative}
#gps .dot::after{content:'';position:absolute;top:50%;left:50%;width:4px;height:4px;border-radius:50%;background:#fff;transform:translate(-50%,-50%)}
#pin-hint{position:absolute;top:58px;left:50%;transform:translateX(-50%);background:rgba(11,122,75,0.9);color:#fff;padding:5px 13px;border-radius:20px;font-size:12px;font-weight:600;z-index:1000;pointer-events:none;white-space:nowrap}
</style>
</head><body>
<div id="search-wrap">
  <div id="search-row">
    <span id="search-icon"></span>
    <input id="search-input" type="text" placeholder="" autocomplete="off" spellcheck="false"/>
    <button id="search-clear" onclick="clearSearch()">✕</button>
  </div>
  <div id="dropdown"></div>
</div>
<div id="map"></div>
<div id="pin-hint"></div>
<button id="gps" onclick="useGps()" aria-label=""><span class="dot"></span></button>
<div id="bar">
  <span id="addr"></span>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var L10N={
  searchPlaceholder:${js(L10n.searchPlaceholder)},
  dragPin:${js(L10n.dragPin)},
  locating:${js(L10n.locating)},
  myLocation:${js(L10n.myLocation)},
  permissionDenied:${js(L10n.permissionDenied)},
  searching:${js(L10n.searching)},
  noResults:${js(L10n.noResults)},
  searchFailed:${js(L10n.searchFailed)}
};
document.getElementById('search-input').placeholder=L10N.searchPlaceholder;
document.getElementById('pin-hint').textContent=L10N.dragPin;
document.getElementById('gps').setAttribute('aria-label', L10N.myLocation);
var LAT=${lat}, LNG=${lng};
var map=L.map('map',{zoomControl:true,attributionControl:false});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
map.setView([LAT,LNG],16);

var pinIcon=L.divIcon({html:'<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#0B7A4B;border:3px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.45)"></div>',className:'',iconSize:[28,28],iconAnchor:[14,28]});
var marker=L.marker([LAT,LNG],{icon:pinIcon,draggable:true}).addTo(map);

/* ── Reverse geocode → emit ── */
function geocode(lat,lng){
  document.getElementById('addr').textContent=L10N.locating;
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

/* ── GPS ── */
function useGps(){
  var btn=document.getElementById('gps');
  btn.disabled=true;btn.textContent=L10N.locating;
  navigator.geolocation.getCurrentPosition(
    function(p){btn.disabled=false;btn.textContent=L10N.myLocation;emit(p.coords.latitude,p.coords.longitude);map.setView([p.coords.latitude,p.coords.longitude],17);},
    function(){btn.disabled=false;btn.textContent=L10N.myLocation;document.getElementById('addr').textContent=L10N.permissionDenied;},
    {enableHighAccuracy:true,timeout:12000}
  );
}

/* ── Search ── */
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
  drop.innerHTML='<div class="dd-loading">'+L10N.searching+'</div>';
  drop.style.display='block';
  fetch('https://nominatim.openstreetmap.org/search?format=json&q='+encodeURIComponent(q)+'&limit=6&addressdetails=1',{headers:{Accept:'application/json'}})
    .then(function(r){return r.json();})
    .then(function(list){
      results=list||[];
      if(!results.length){drop.innerHTML='<div class="dd-empty">'+L10N.noResults+'</div>';return;}
      activeIdx=-1;
      drop.innerHTML=results.map(function(r,i){
        var a=r.address||{};
        var main=r.name||a.road||a.neighbourhood||r.display_name.split(',')[0]||'';
        var sub=r.display_name.replace(main,'').replace(/^[,\\s]+/,'');
        return '<div class="dd-item" data-idx="'+i+'" onmousedown="pickIdx('+i+')">'
          +'<span class="dd-pin"></span>'
          +'<div><div class="dd-main">'+main+'</div><div class="dd-sub">'+sub+'</div></div>'
          +'</div>';
      }).join('');
    })
    .catch(function(){drop.innerHTML='<div class="dd-empty">'+L10N.searchFailed+'</div>';});
}

function pickIdx(i){
  if(results[i])selectResult(results[i]);
}

function selectResult(r){
  var lat=parseFloat(r.lat),lng=parseFloat(r.lon);
  closeDrop();
  inp.value=r.display_name.split(',').slice(0,2).join(',').trim();
  clearBtn.style.display='block';
  map.setView([lat,lng],17);
  emit(lat,lng);
}

function clearSearch(){
  inp.value='';clearBtn.style.display='none';closeDrop();inp.focus();
}

function closeDrop(){drop.style.display='none';drop.innerHTML='';activeIdx=-1;results=[];}

// Close dropdown when clicking outside
document.addEventListener('mousedown',function(e){
  if(!document.getElementById('search-wrap').contains(e.target))closeDrop();
});

/* ── Hint hide ── */
var hint=document.getElementById('pin-hint');
map.once('click',function(){hint.style.display='none';});
marker.once('drag',function(){hint.style.display='none';});

/* ── External messages ── */
window.addEventListener('message',function(ev){
  var m=ev.data;
  if(m&&m.type==='setLocation')emit(m.lat,m.lng);
});

geocode(LAT,LNG);
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
  const { t } = useLang();
  const lat = initial?.lat ?? DEFAULT_LAT;
  const lng = initial?.lng ?? DEFAULT_LNG;
  const labels: PickerLabels = {
    searchPlaceholder: t.locationPicker.searchPlaceholder,
    dragPin: t.locationPicker.dragPin,
    locating: t.locationPicker.locating,
    myLocation: t.locationPicker.myLocation,
    permissionDenied: t.locationPicker.permissionDenied,
    searching: t.locationPicker.searching,
    noResults: t.locationPicker.noResults,
    searchFailed: t.locationPicker.searchFailed,
  };
  const doc = useMemo(() => buildPickerDoc(lat, lng, labels), []); // eslint-disable-line react-hooks/exhaustive-deps
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
        title={t.locationPicker.setLocation}
        style={{ border: '0', width: '100%', height: '100%', display: 'block', borderRadius: 12 }}
      />
    </View>
  );
}

/* ------------------------------------------------------------- Native fallback */

function NativePicker({
  initial,
  onChange,
}: {
  initial?: PickedLocation;
  onChange: (loc: PickedLocation) => void;
}) {
  const { t } = useLang();
  const [locating, setLocating] = useState(false);
  const [picked, setPicked] = useState<PickedLocation | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);

  function useGps() {
    const geo =
      typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;
    if (!geo) { setError(t.locationPicker.notAvailable); return; }
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
        setError(t.locationPicker.couldNotGet);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  return (
    <View style={styles.nativeWrap}>
      <View style={styles.nativeBox}>
        <Text style={styles.nativeTitle}>{t.locationPicker.setLocation}</Text>
        <Text style={styles.nativeSub}>
          {picked
            ? `${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}`
            : t.locationPicker.tapToUseGps}
        </Text>
      </View>
      <Pressable
        onPress={useGps}
        disabled={locating}
        style={[styles.gpsBtn, locating && styles.gpsBtnDisabled]}
      >
        {locating ? (
          <ActivityIndicator color={theme.color.onPrimary} />
        ) : (
          <Text style={styles.gpsBtnText}>{t.locationPicker.useMyLocation}</Text>
        )}
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {picked ? (
        <Text style={styles.confirmedText}>{t.locationPicker.locationSet}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: {
    width: '100%',
    height: 340,
    borderRadius: 12,
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
  nativeMapEmoji: { fontSize: 40 },
  nativeTitle: { fontSize: theme.font.body, fontWeight: theme.weight.bold, color: theme.color.text },
  nativeSub: { fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center' },

  gpsBtn: {
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsBtnDisabled: { opacity: 0.6 },
  gpsBtnText: { color: theme.color.onPrimary, fontWeight: theme.weight.bold, fontSize: theme.font.body },

  errorText: { fontSize: theme.font.small, color: theme.color.danger, textAlign: 'center' },
  confirmedText: { fontSize: theme.font.small, color: theme.color.success, fontWeight: theme.weight.semibold, textAlign: 'center' },
});
