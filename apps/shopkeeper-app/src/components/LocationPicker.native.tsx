/**
 * LocationPicker (NATIVE) — pin a shop location on iOS/Android.
 *
 * Native reimplementation of the web LocationPicker (which uses a Leaflet
 * iframe). Uses react-native-maps with a draggable marker, a "use my location"
 * button (via ./geo), and Nominatim for search + reverse-geocoding so it
 * returns the same { lat, lng, street, area } shape as the web version.
 *
 * NOTE: on Android the map may render blank until a Google Maps API key is
 * configured — that is expected and does not crash.
 */
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, type MapPressEvent, type MarkerDragStartEndEvent, type Region } from 'react-native-maps';
import { theme } from '../theme';
import { getCurrentCoords } from '../geo';

export interface PickedLocation {
  lat: number;
  lng: number;
  street?: string;
  area?: string;
}

const DEFAULT_LAT = 22.9734; // India geographic center
const DEFAULT_LNG = 78.6569;

interface SearchResult {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: Record<string, string>;
}

async function reverseGeocode(lat: number, lng: number): Promise<{ street: string; area: string }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
      { headers: { Accept: 'application/json' } },
    );
    const d = await res.json();
    const a = d.address || {};
    const road = a.road || a.street || a.pedestrian || a.footway || '';
    const suburb = a.suburb || a.neighbourhood || a.quarter || a.village || a.town || '';
    const city = a.city || a.state_district || a.county || '';
    const area = [suburb, city].filter(Boolean).join(', ');
    return { street: road, area };
  } catch {
    return { street: '', area: '' };
  }
}

export function LocationPicker({
  initial,
  onChange,
}: {
  initial?: PickedLocation;
  onChange: (loc: PickedLocation) => void;
}) {
  const startLat = initial?.lat ?? DEFAULT_LAT;
  const startLng = initial?.lng ?? DEFAULT_LNG;

  const mapRef = useRef<MapView | null>(null);
  const [region, setRegion] = useState<Region>({
    latitude: startLat,
    longitude: startLng,
    latitudeDelta: initial ? 0.01 : 8,
    longitudeDelta: initial ? 0.01 : 8,
  });
  const [marker, setMarker] = useState<{ lat: number; lng: number }>({ lat: startLat, lng: startLng });
  const [hasPicked, setHasPicked] = useState(!!initial);
  const [addr, setAddr] = useState<string>(initial ? 'Location set' : 'Drop pin or use GPS to set location');
  const [locating, setLocating] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function commit(lat: number, lng: number) {
    setMarker({ lat, lng });
    setHasPicked(true);
    setAddr('Locating…');
    const { street, area } = await reverseGeocode(lat, lng);
    setAddr([street, area].filter(Boolean).join(', ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    onChange({ lat, lng, street, area });
  }

  function animateTo(lat: number, lng: number, delta = 0.01) {
    const next: Region = { latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta };
    setRegion(next);
    mapRef.current?.animateToRegion(next, 400);
  }

  function onMapPress(e: MapPressEvent) {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    void commit(latitude, longitude);
  }

  function onMarkerDragEnd(e: MarkerDragStartEndEvent) {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    void commit(latitude, longitude);
  }

  async function useGps() {
    setLocating(true);
    const coords = await getCurrentCoords({ timeoutMs: 12000 });
    setLocating(false);
    if (!coords) {
      setAddr('Location permission denied');
      return;
    }
    animateTo(coords.lat, coords.lng, 0.008);
    void commit(coords.lat, coords.lng);
  }

  function onQueryChange(text: string) {
    setQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!text.trim()) {
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => void doSearch(text.trim()), 350);
  }

  async function doSearch(q: string) {
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6&addressdetails=1`,
        { headers: { Accept: 'application/json' } },
      );
      const list = (await res.json()) as SearchResult[];
      setResults(list || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function selectResult(r: SearchResult) {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    setQuery(r.display_name.split(',').slice(0, 2).join(',').trim());
    setResults([]);
    Keyboard.dismiss();
    animateTo(lat, lng, 0.008);
    void commit(lat, lng);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search your shop location…"
          placeholderTextColor={theme.color.textFaint}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {query ? (
          <Pressable onPress={() => { setQuery(''); setResults([]); }} hitSlop={8}>
            <Text style={styles.clear}>✕</Text>
          </Pressable>
        ) : null}
        {(results.length > 0 || searching) ? (
          <View style={styles.dropdown}>
            {searching ? (
              <Text style={styles.ddEmpty}>Searching…</Text>
            ) : (
              <FlatList
                data={results}
                keyboardShouldPersistTaps="handled"
                keyExtractor={(_, i) => String(i)}
                renderItem={({ item }) => {
                  const main = item.name || item.display_name.split(',')[0] || '';
                  const sub = item.display_name.replace(main, '').replace(/^[,\s]+/, '');
                  return (
                    <Pressable style={styles.ddItem} onPress={() => selectResult(item)}>
                      <Text style={styles.ddMain} numberOfLines={1}>{main}</Text>
                      {sub ? <Text style={styles.ddSub} numberOfLines={1}>{sub}</Text> : null}
                    </Pressable>
                  );
                }}
              />
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          onPress={onMapPress}
        >
          {hasPicked ? (
            <Marker
              coordinate={{ latitude: marker.lat, longitude: marker.lng }}
              draggable
              onDragEnd={onMarkerDragEnd}
            />
          ) : null}
        </MapView>

        <Pressable style={[styles.gps, locating && styles.gpsBusy]} onPress={useGps} disabled={locating}>
          {locating ? <ActivityIndicator color="#fff" /> : <View style={styles.gpsDot} />}
        </Pressable>
      </View>

      <View style={styles.bar}>
        <Text style={styles.addr} numberOfLines={1}>{addr}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  searchWrap: {
    padding: theme.space.sm,
    backgroundColor: theme.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
  },
  searchInput: {
    flex: 1,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    fontSize: theme.font.small,
    color: theme.color.text,
  },
  clear: { fontSize: 16, color: theme.color.textFaint, paddingHorizontal: 4 },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: theme.space.sm,
    right: theme.space.sm,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    maxHeight: 220,
    zIndex: 3000,
    ...theme.shadow.md,
  },
  ddItem: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.surfaceAlt,
  },
  ddMain: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.text },
  ddSub: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 2 },
  ddEmpty: { padding: theme.space.md, fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center' },
  mapWrap: { width: '100%', height: 300, backgroundColor: theme.color.surfaceAlt },
  gps: {
    position: 'absolute',
    right: 12,
    bottom: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1A73E8',
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadow.md,
  },
  gpsBusy: { opacity: 0.6 },
  gpsDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: '#fff' },
  bar: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  addr: { fontSize: theme.font.small, color: theme.color.text },
});
