/**
 * Shared geolocation helper — WEB variant (Metro loads geo.native.ts on
 * iOS/Android). Wraps the browser `navigator.geolocation` API behind a small,
 * platform-agnostic contract so screens don't reach into globals directly.
 * Every function is defensive: it guards for a missing `navigator` (SSR / older
 * browsers) and never throws — errors resolve to null / call the onError hook.
 */
export interface Coords {
  lat: number;
  lng: number;
}

/** Grab the geolocation object if the browser exposes one. */
function getGeo(): Geolocation | undefined {
  return typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
}

/**
 * On web there is no explicit permission request up-front — the browser prompts
 * on first use. We simply report whether geolocation is available at all.
 */
export async function ensureLocationPermission(): Promise<boolean> {
  return !!getGeo();
}

/** Read a single fix (best-effort). Resolves null on error/unavailable. */
export async function getCurrentCoords(opts?: { timeoutMs?: number }): Promise<Coords | null> {
  const geo = getGeo();
  if (!geo) return null;
  const timeout = opts?.timeoutMs ?? 10000;
  return new Promise<Coords | null>((resolve) => {
    geo.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout },
    );
  });
}

/**
 * Subscribe to position updates. Returns an unsubscribe function that clears the
 * underlying watch. No-op unsubscribe when geolocation is unavailable.
 */
export function watchCoords(
  onChange: (c: Coords) => void,
  onError?: (e: unknown) => void,
): () => void {
  const geo = getGeo();
  if (!geo) {
    onError?.(new Error('Geolocation unavailable'));
    return () => undefined;
  }
  const id = geo.watchPosition(
    (pos) => onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    (err) => onError?.(err),
    { enableHighAccuracy: true, timeout: 10000 },
  );
  return () => geo.clearWatch(id);
}
