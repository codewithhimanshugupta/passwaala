/**
 * NearbyShopsMap (NATIVE variant) — the nearby-shops discovery map on
 * iOS/Android, drawn with react-native-maps. Same props as the web sibling
 * (`NearbyShopsMap.tsx`) so DiscoveryScreen renders `<NearbyShopsMap/>` on both
 * platforms with no branching at the call site.
 *
 * A marker per shop (green = open, grey = closed, highlighted when selected), a
 * user dot at `center` with a delivery-radius `Circle`, and tapping a marker
 * selects the shop (same as clicking a web pin). Panning/zooming reports the
 * visible radius via `onRadiusChange` so the screen can widen its search.
 */
import { useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker, type Region } from 'react-native-maps';
import type { NearbyShop } from '@nearbaz/api-client';
import type { ShopContactFields } from '../types';
import { haversineMeters, theme } from '../theme';

export function NearbyShopsMap({ shops, center, selected, onSelect, onRadiusChange, radiusMeters }: {
  shops: NearbyShop[];
  center: { lat: number; lng: number };
  selected: NearbyShop | null;
  onSelect: (shop: NearbyShop | null) => void;
  onRadiusChange?: (radius: number) => void;
  /** Delivery radius (metres) drawn as a circle around the user. */
  radiusMeters?: number;
}) {
  const mapRef = useRef<MapView | null>(null);

  // Shops with usable coordinates.
  const pins = useMemo(
    () =>
      shops
        .map((s) => {
          const sc = s as NearbyShop & ShopContactFields;
          const lat = sc.latitude != null ? Number(sc.latitude) : NaN;
          const lng = sc.longitude != null ? Number(sc.longitude) : NaN;
          return { shop: s, lat, lng };
        })
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    [shops],
  );

  const initialRegion: Region = useMemo(() => {
    const lats = [center.lat, ...pins.map((p) => p.lat)];
    const lngs = [center.lng, ...pins.map((p) => p.lng)];
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.5),
      longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.5),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Report the visible radius (centre → corner) so the screen can load more.
  function handleRegionChange(region: Region) {
    if (!onRadiusChange) return;
    const corner = {
      lat: region.latitude + region.latitudeDelta / 2,
      lng: region.longitude + region.longitudeDelta / 2,
    };
    const radius = Math.round(haversineMeters({ lat: region.latitude, lng: region.longitude }, corner));
    if (radius > 0) onRadiusChange(radius);
  }

  return (
    <View style={styles.fill}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        onRegionChangeComplete={handleRegionChange}
        showsUserLocation={false}
      >
        {/* User location dot */}
        <Marker coordinate={{ latitude: center.lat, longitude: center.lng }} title="You" pinColor="#2563EB" />
        {/* Delivery-radius circle */}
        {radiusMeters && radiusMeters > 0 ? (
          <Circle
            center={{ latitude: center.lat, longitude: center.lng }}
            radius={radiusMeters}
            strokeColor="rgba(37,99,235,0.5)"
            fillColor="rgba(37,99,235,0.08)"
            strokeWidth={1.5}
          />
        ) : null}
        {/* Shop pins */}
        {pins.map(({ shop, lat, lng }) => (
          <Marker
            key={shop.id}
            coordinate={{ latitude: lat, longitude: lng }}
            title={shop.name}
            pinColor={
              selected?.id === shop.id
                ? theme.color.primaryDark
                : shop.isOpen
                  ? theme.color.primary
                  : '#9CA3AF'
            }
            onPress={() => onSelect(shop)}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 380 },
});
