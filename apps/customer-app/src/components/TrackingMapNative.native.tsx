/**
 * TrackingMapNative — native (iOS/Android) live order tracking, drawn with
 * react-native-maps. Same props as SchematicMap so TrackingMap can drop it into
 * the native branch. The web build never loads this file (TrackingMap keeps its
 * Leaflet iframe for web).
 *
 * Renders real map tiles with shop / drop / extra-shop markers, an animated
 * rider marker, and a leg-aware route Polyline fetched from OSRM (rider→shop on
 * the "to_shop" leg, shop→drop on "to_customer"). If MapView fails to render
 * (e.g. Android without a Google Maps API key) the map is blank — it never
 * crashes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, {
  AnimatedRegion,
  Marker,
  MarkerAnimated,
  Polyline,
  type Region,
} from 'react-native-maps';
import { theme } from '../theme';
import type { Geo, TripPhase } from './TrackingMap';

type LatLng = { latitude: number; longitude: number };

function captionFor(phase: TripPhase, hasRider: boolean): string {
  if (!hasRider) return 'Waiting for your rider to start moving';
  return phase === 'to_shop' ? 'Your rider is heading to the shop' : 'Your rider is on the way to you';
}

export function TrackingMapNative({
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
  const mapRef = useRef<MapView | null>(null);
  const [route, setRoute] = useState<LatLng[]>([]);
  const routeSeq = useRef(0);

  // Animated rider position (smoothly interpolates between live fixes).
  const riderRegion = useRef(
    new AnimatedRegion({
      latitude: rider?.lat ?? shop.lat,
      longitude: rider?.lng ?? shop.lng,
      latitudeDelta: 0,
      longitudeDelta: 0,
    }),
  ).current;

  const allPts = useMemo(
    () => [shop, drop, ...extraShops, ...(rider ? [rider] : [])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shop.lat, shop.lng, drop.lat, drop.lng, extraShops.length, rider?.lat, rider?.lng],
  );

  // Initial region: the bounding box of all fixed points, padded.
  const initialRegion: Region = useMemo(() => {
    const lats = allPts.map((p) => p.lat);
    const lngs = allPts.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.6),
      longitudeDelta: Math.max(0.01, (maxLng - minLng) * 1.6),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leg-aware route: to_shop → rider(or shop)→shop; to_customer → shop→drop.
  // Draw a straight line immediately, then upgrade to the OSRM road geometry.
  useEffect(() => {
    const from = phase === 'to_shop' ? rider ?? shop : shop;
    const to = phase === 'to_shop' ? shop : drop;
    const seq = ++routeSeq.current;
    setRoute([
      { latitude: from.lat, longitude: from.lng },
      { latitude: to.lat, longitude: to.lng },
    ]);
    (async () => {
      try {
        const url =
          `https://router.project-osrm.org/route/v1/driving/` +
          `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const json = (await res.json()) as {
          routes?: { geometry?: { coordinates?: [number, number][] } }[];
        };
        if (seq !== routeSeq.current) return;
        const coords = json?.routes?.[0]?.geometry?.coordinates;
        if (Array.isArray(coords) && coords.length) {
          setRoute(coords.map((p) => ({ latitude: p[1], longitude: p[0] })));
        }
      } catch {
        /* keep the straight-line fallback */
      }
    })();
  }, [phase, shop.lat, shop.lng, drop.lat, drop.lng, rider?.lat, rider?.lng]);

  // Animate the rider marker toward each new fix.
  useEffect(() => {
    if (!rider) return;
    const next = { latitude: rider.lat, longitude: rider.lng, latitudeDelta: 0, longitudeDelta: 0 };
    try {
      // AnimatedRegion.timing animates to the given coordinate over `duration`.
      // The typings insist on a `toValue`, which this overload ignores.
      riderRegion
        .timing({ ...next, duration: 1000, useNativeDriver: false } as never)
        .start();
    } catch {
      /* ignore — animation is best-effort */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rider?.lat, rider?.lng]);

  // Fit the viewport to the current route (or all fixed points).
  useEffect(() => {
    const pts = route.length ? route : allPts.map((p) => ({ latitude: p.lat, longitude: p.lng }));
    if (mapRef.current && pts.length) {
      try {
        mapRef.current.fitToCoordinates(pts, {
          edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
          animated: true,
        });
      } catch {
        /* ignore */
      }
    }
  }, [route, allPts]);

  return (
    <View style={styles.wrap}>
      <View style={styles.box}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={initialRegion}
          toolbarEnabled={false}
          showsUserLocation={false}
        >
          <Marker coordinate={{ latitude: shop.lat, longitude: shop.lng }} title="Shop" pinColor="#0B7A4B" />
          <Marker coordinate={{ latitude: drop.lat, longitude: drop.lng }} title="Delivery" pinColor="#2563EB" />
          {extraShops.map((es, i) => (
            <Marker
              key={`extra-${i}`}
              coordinate={{ latitude: es.lat, longitude: es.lng }}
              title={`Shop ${i + 2}`}
              pinColor={currentShopIndex === i + 1 ? '#7C3AED' : '#9CA3AF'}
            />
          ))}
          {route.length ? (
            <Polyline coordinates={route} strokeColor="#0B7A4B" strokeWidth={5} />
          ) : null}
          {rider ? (
            <MarkerAnimated
              coordinate={riderRegion as unknown as LatLng}
              title="Rider"
              pinColor="#E53935"
            />
          ) : null}
        </MapView>
      </View>
      <Text style={styles.caption}>{captionFor(phase, !!rider)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: theme.space.xs },
  box: {
    width: '100%',
    height: 200,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  caption: { fontSize: theme.font.tiny, color: theme.color.textMuted },
});
