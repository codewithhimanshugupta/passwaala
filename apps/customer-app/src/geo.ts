/**
 * Shared geolocation helper (WEB variant). Metro loads `geo.native.ts` on
 * iOS/Android instead; this file stays the browser implementation and wraps
 * `navigator.geolocation`. The exported contract is identical on both platforms
 * so call sites never branch on Platform.OS.
 */

/** A lat/lng point. */
export interface Coords {
  lat: number;
  lng: number;
}

/** Default GPS timeout (ms) for a one-shot fix. */
const DEFAULT_TIMEOUT_MS = 10000;

function getGeo(): Geolocation | null {
  return typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;
}

/**
 * Whether location can be used. On web the browser prompts on first use, so we
 * simply report whether the geolocation API exists.
 */
export async function ensureLocationPermission(): Promise<boolean> {
  return getGeo() != null;
}

/** Read the current position once. Resolves null on error / denied / no API. */
export async function getCurrentCoords(opts?: { timeoutMs?: number }): Promise<Coords | null> {
  const geo = getGeo();
  if (!geo) return null;
  const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise<Coords | null>((resolve) => {
    try {
      geo.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout },
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * Watch position changes. Calls `onChange` on every fix; returns an unsubscribe
 * function. No-ops (returns a no-op unsubscribe) when the API is unavailable.
 */
export function watchCoords(onChange: (c: Coords) => void, onError?: (e: unknown) => void): () => void {
  const geo = getGeo();
  if (!geo) return () => undefined;
  let id: number | null = null;
  try {
    id = geo.watchPosition(
      (pos) => onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (e) => onError?.(e),
      { enableHighAccuracy: true },
    );
  } catch (e) {
    onError?.(e);
  }
  return () => {
    if (id != null) {
      try {
        geo.clearWatch(id);
      } catch {
        /* ignore */
      }
    }
  };
}

/** Open turn-by-turn directions to `dest` in a new tab (Google Maps). */
export function openDirections(dest: Coords, _label?: string): void {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}`;
  if (typeof window !== 'undefined') window.open(url, '_blank');
}
