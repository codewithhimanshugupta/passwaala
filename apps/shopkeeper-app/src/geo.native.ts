/**
 * geo (NATIVE) — shared geolocation helper for the shopkeeper app.
 *
 * Uses `expo-location` for permission + position, and `Linking` to open the
 * platform maps app for directions. Mirrors the web contract in `geo.ts`.
 */
import { Linking, Platform } from 'react-native';
import * as Location from 'expo-location';

export interface Coords {
  lat: number;
  lng: number;
}

export async function ensureLocationPermission(): Promise<boolean> {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

export async function getCurrentCoords(opts?: { timeoutMs?: number }): Promise<Coords | null> {
  const timeoutMs = opts?.timeoutMs ?? 10000;
  try {
    const granted = await ensureLocationPermission();
    if (!granted) return null;

    const positionPromise = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    }).then<Coords>((pos) => ({ lat: pos.coords.latitude, lng: pos.coords.longitude }));

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    });

    return await Promise.race([positionPromise, timeoutPromise]);
  } catch {
    return null;
  }
}

export function openDirections(dest: Coords, _label?: string): void {
  const { lat, lng } = dest;
  const url = Platform.OS === 'ios'
    ? `http://maps.apple.com/?daddr=${lat},${lng}`
    : `google.navigation:q=${lat},${lng}`;
  Linking.openURL(url).catch(() => {
    // Never throw — fall back to a universal Google Maps URL.
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`).catch(() => {});
  });
}
