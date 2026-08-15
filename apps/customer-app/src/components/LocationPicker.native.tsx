/**
 * LocationPicker (NATIVE variant). Metro loads this on iOS/Android; the web
 * build keeps the Leaflet-iframe picker in `LocationPicker.tsx`. Same exported
 * name / props / signature as the web sibling so `AddressForm` is unchanged.
 *
 * A full native reimplementation using react-native-maps: an interactive map
 * with a draggable pin (drag or tap to move), a floating "use my location"
 * button (expo-location via `./geo`), and a Nominatim search box + reverse
 * geocode (the same OpenStreetMap endpoints the web picker uses — they work via
 * `fetch` on native too). `onChange` fires whenever the pin moves.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { theme } from '../theme';
import { useLang } from '../i18n/LanguageContext';
import { getCurrentCoords } from '../geo';

export interface PickedLocation {
  lat: number;
  lng: number;
  street?: string;
  area?: string;
}

/** India geographic center — neutral default when GPS unavailable */
const DEFAULT_LAT = 22.9734;
const DEFAULT_LNG = 78.6569;

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: Record<string, string>;
};

export function LocationPicker({
  initial,
  onChange,
}: {
  initial?: PickedLocation;
  onChange: (loc: PickedLocation) => void;
}) {
  const { t } = useLang();
  const mapRef = useRef<MapView | null>(null);

  const startLat = initial?.lat ?? DEFAULT_LAT;
  const startLng = initial?.lng ?? DEFAULT_LNG;
  const hasInitial = initial?.lat != null && initial?.lng != null;

  const [marker, setMarker] = useState({ lat: startLat, lng: startLng });
  const [addr, setAddr] = useState<string>('');
  const [locating, setLocating] = useState(false);

  // Search state.
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialRegion: Region = {
    latitude: startLat,
    longitude: startLng,
    latitudeDelta: hasInitial ? 0.01 : 8,
    longitudeDelta: hasInitial ? 0.01 : 8,
  };

  // Reverse-geocode a point → update the address line and emit via onChange.
  async function emit(lat: number, lng: number) {
    setMarker({ lat, lng });
    setAddr(t.locationPicker.locating);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
        { headers: { Accept: 'application/json' } },
      );
      const d = (await res.json()) as { address?: Record<string, string>; display_name?: string };
      const a = d.address ?? {};
      const road = a.road || a.street || a.pedestrian || a.footway || '';
      const suburb = a.suburb || a.neighbourhood || a.quarter || a.village || a.town || '';
      const city = a.city || a.state_district || a.county || '';
      const area = [suburb, city].filter(Boolean).join(', ');
      setAddr([road, area].filter(Boolean).join(', ') || d.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      onChange({ lat, lng, street: road, area });
    } catch {
      setAddr(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      onChange({ lat, lng, street: '', area: '' });
    }
  }

  // Reverse-geocode the starting point on mount so the address bar is populated.
  useEffect(() => {
    void emit(startLat, startLng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function moveTo(lat: number, lng: number, zoom = false) {
    mapRef.current?.animateToRegion(
      {
        latitude: lat,
        longitude: lng,
        latitudeDelta: zoom ? 0.005 : 0.01,
        longitudeDelta: zoom ? 0.005 : 0.01,
      },
      400,
    );
  }

  async function useGps() {
    setLocating(true);
    const coords = await getCurrentCoords({ timeoutMs: 12000 });
    setLocating(false);
    if (coords) {
      moveTo(coords.lat, coords.lng, true);
      void emit(coords.lat, coords.lng);
    } else {
      setAddr(t.locationPicker.permissionDenied);
    }
  }

  // Nominatim forward search (debounced), matching the web picker.
  function onQueryChange(text: string) {
    setQuery(text);
    const q = text.trim();
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q) {
      setResults([]);
      setDropOpen(false);
      return;
    }
    setDropOpen(true);
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6&addressdetails=1`,
            { headers: { Accept: 'application/json' } },
          );
          const list = (await res.json()) as NominatimResult[];
          setResults(Array.isArray(list) ? list : []);
        } catch {
          setResults([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 300);
  }

  function selectResult(r: NominatimResult) {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    setQuery(r.display_name.split(',').slice(0, 2).join(',').trim());
    setDropOpen(false);
    setResults([]);
    moveTo(lat, lng, true);
    void emit(lat, lng);
  }

  return (
    <View style={styles.wrap}>
      {/* Search bar */}
      <View style={styles.searchWrap}>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder={t.locationPicker.searchPlaceholder}
            placeholderTextColor={theme.color.textFaint}
            value={query}
            onChangeText={onQueryChange}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable
              hitSlop={8}
              onPress={() => {
                setQuery('');
                setResults([]);
                setDropOpen(false);
              }}
            >
              <Text style={styles.searchClear}>✕</Text>
            </Pressable>
          ) : null}
        </View>
        {dropOpen ? (
          <View style={styles.dropdown}>
            {searching ? (
              <Text style={styles.ddInfo}>{t.locationPicker.searching}</Text>
            ) : results.length === 0 ? (
              <Text style={styles.ddInfo}>{t.locationPicker.noResults}</Text>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" style={styles.ddScroll}>
                {results.map((r, i) => {
                  const a = r.address ?? {};
                  const main = r.name || a.road || a.neighbourhood || r.display_name.split(',')[0] || '';
                  const sub = r.display_name.replace(main, '').replace(/^[,\s]+/, '');
                  return (
                    <Pressable
                      key={`${r.lat},${r.lon},${i}`}
                      style={({ pressed }) => [styles.ddItem, pressed && styles.ddItemPressed]}
                      onPress={() => selectResult(r)}
                    >
                      <Text style={styles.ddMain} numberOfLines={1}>{main}</Text>
                      <Text style={styles.ddSub} numberOfLines={1}>{sub}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        ) : null}
      </View>

      {/* Map with draggable pin */}
      <View style={styles.mapBox}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={initialRegion}
          onPress={(e) => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            void emit(latitude, longitude);
          }}
        >
          <Marker
            coordinate={{ latitude: marker.lat, longitude: marker.lng }}
            draggable
            pinColor={theme.color.primary}
            onDragEnd={(e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              void emit(latitude, longitude);
            }}
          />
        </MapView>

        {/* Floating "use my location" button (maps-style blue dot). */}
        <Pressable
          onPress={useGps}
          disabled={locating}
          style={[styles.gpsBtn, locating && styles.gpsBtnDisabled]}
          accessibilityLabel={t.locationPicker.myLocation}
        >
          {locating ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <View style={styles.gpsDot} />
          )}
        </Pressable>

        {/* Address bar */}
        <View style={styles.addrBar}>
          <Text style={styles.addrText} numberOfLines={1}>
            {addr || `${marker.lat.toFixed(5)}, ${marker.lng.toFixed(5)}`}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    height: 340,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceAlt,
  },

  searchWrap: {
    position: 'relative',
    padding: theme.space.sm,
    backgroundColor: theme.color.bg,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    zIndex: 20,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1.5,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 7,
  },
  searchInput: { flex: 1, fontSize: theme.font.body, color: theme.color.text, padding: 0 },
  searchClear: { fontSize: theme.font.body, color: theme.color.textMuted, fontWeight: theme.weight.bold },

  dropdown: {
    position: 'absolute',
    top: '100%',
    left: theme.space.sm,
    right: theme.space.sm,
    backgroundColor: theme.color.bg,
    borderWidth: 1.5,
    borderColor: theme.color.border,
    borderTopWidth: 0,
    borderBottomLeftRadius: theme.radius.md,
    borderBottomRightRadius: theme.radius.md,
    maxHeight: 200,
    zIndex: 30,
  },
  ddScroll: { maxHeight: 200 },
  ddInfo: { padding: theme.space.md, fontSize: theme.font.small, color: theme.color.textMuted, textAlign: 'center' },
  ddItem: { paddingHorizontal: theme.space.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.surfaceAlt },
  ddItemPressed: { backgroundColor: theme.color.primaryLight },
  ddMain: { fontSize: theme.font.small, fontWeight: theme.weight.semibold, color: theme.color.text },
  ddSub: { fontSize: theme.font.tiny, color: theme.color.textMuted, marginTop: 2 },

  mapBox: { flex: 1, position: 'relative' },

  gpsBtn: {
    position: 'absolute',
    right: 12,
    bottom: 66,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1A73E8',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadowLift(),
  },
  gpsBtnDisabled: { opacity: 0.55 },
  gpsDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#fff',
  },

  addrBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingHorizontal: theme.space.md,
    paddingVertical: 10,
  },
  addrText: { fontSize: theme.font.small, color: theme.color.text },
});

/** Small elevation for the floating GPS button. */
function shadowLift() {
  return {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  };
}
