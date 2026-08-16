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

/**
 * Open Google Maps directions to a destination string ("lat,lng" or an
 * already-encoded address). Navigates the CURRENT tab — opening a new `_blank`
 * tab shows a blank white screen on mobile browsers before Maps loads. Same-tab
 * hands off to the Maps app immediately; the browser back button returns here.
 */
export function openMapsDirections(destination: string): void {
  if (typeof window === 'undefined') return;
  window.location.href = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

/** Open turn-by-turn directions to `dest` (Google Maps, same tab on web). */
export function openDirections(dest: Coords, _label?: string): void {
  openMapsDirections(`${dest.lat},${dest.lng}`);
}
