/**
 * Shared geolocation helper (NATIVE variant). Metro loads this file on
 * iOS/Android; the web build keeps `geo.ts`. Same exported contract as the web
 * version so call sites are identical. Backed by expo-location; never throws —
 * swallows errors and returns null / no-ops.
 */
import { Linking, Platform } from 'react-native';
import * as Location from 'expo-location';

/** A lat/lng point. */
export interface Coords {
  lat: number;
  lng: number;
}

/** Default GPS timeout (ms) for a one-shot fix. */
const DEFAULT_TIMEOUT_MS = 10000;

/** Ask for foreground location permission. Returns true only when granted. */
export async function ensureLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Read the current position once (after ensuring permission). Resolves null on
 * denial, error, or if the fix doesn't arrive within `timeoutMs`.
 */
export async function getCurrentCoords(opts?: { timeoutMs?: number }): Promise<Coords | null> {
  const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const granted = await ensureLocationPermission();
    if (!granted) return null;
    const fix = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(
      (pos): Coords => ({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    );
    const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout));
    return await Promise.race([fix, timer]);
  } catch {
    return null;
  }
}

/**
 * Watch position changes. Calls `onChange` on every fix; returns an unsubscribe
 * function that removes the subscription. No-ops when permission is denied.
 */
export function watchCoords(onChange: (c: Coords) => void, onError?: (e: unknown) => void): () => void {
  let sub: Location.LocationSubscription | null = null;
  let cancelled = false;
  (async () => {
    try {
      const granted = await ensureLocationPermission();
      if (!granted || cancelled) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
        (pos) => onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      );
      if (cancelled) {
        sub.remove();
        sub = null;
      }
    } catch (e) {
      onError?.(e);
    }
  })();
  return () => {
    cancelled = true;
    if (sub) {
      try {
        sub.remove();
      } catch {
        /* ignore */
      }
      sub = null;
    }
  };
}

/** Open turn-by-turn directions to `dest` in the platform maps app. */
export function openDirections(dest: Coords, _label?: string): void {
  const primary =
    Platform.OS === 'android'
      ? `google.navigation:q=${dest.lat},${dest.lng}`
      : `http://maps.apple.com/?daddr=${dest.lat},${dest.lng}`;
  const fallback = `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}`;
  Linking.openURL(primary).catch(() => {
    Linking.openURL(fallback).catch(() => undefined);
  });
}
