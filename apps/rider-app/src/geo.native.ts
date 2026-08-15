/**
 * Shared geolocation helper — NATIVE variant (Metro loads this over geo.ts on
 * iOS/Android). Backed by expo-location. Same contract as geo.ts so screens are
 * platform-agnostic. Every function is defensive and never throws — failures
 * resolve to null / call the onError hook so callers stay simple.
 */
import * as Location from 'expo-location';

export interface Coords {
  lat: number;
  lng: number;
}

/** Request foreground location permission; true when granted. Never throws. */
export async function ensureLocationPermission(): Promise<boolean> {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

/**
 * Read a single fix (best-effort). Requests permission first, then races the
 * position read against a manual timeout so a stuck GPS never hangs the caller.
 * Resolves null on denial / error / timeout.
 */
export async function getCurrentCoords(opts?: { timeoutMs?: number }): Promise<Coords | null> {
  const timeout = opts?.timeoutMs ?? 10000;
  try {
    const ok = await ensureLocationPermission();
    if (!ok) return null;
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout)),
    ]);
    if (!position) return null;
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * Subscribe to position updates via watchPositionAsync. Returns an unsubscribe
 * function that removes the underlying subscription. Never throws — permission
 * denial / errors are reported through onError.
 */
export function watchCoords(
  onChange: (c: Coords) => void,
  onError?: (e: unknown) => void,
): () => void {
  let subscription: Location.LocationSubscription | null = null;
  let cancelled = false;

  (async () => {
    try {
      const ok = await ensureLocationPermission();
      if (!ok) {
        onError?.(new Error('Location permission denied'));
        return;
      }
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
        (pos) => onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      );
      // If the caller unsubscribed before the async setup finished, tear down now.
      if (cancelled) sub.remove();
      else subscription = sub;
    } catch (e) {
      onError?.(e);
    }
  })();

  return () => {
    cancelled = true;
    subscription?.remove();
    subscription = null;
  };
}
