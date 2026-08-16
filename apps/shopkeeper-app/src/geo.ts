/**
 * geo (WEB) — shared geolocation helper for the shopkeeper app.
 *
 * Wraps the browser `navigator.geolocation` API. The native sibling
 * (`geo.native.ts`) provides the same contract using `expo-location`.
 */
export interface Coords {
  lat: number;
  lng: number;
}

function getGeo(): Geolocation | null {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return navigator.geolocation;
}

/** On web, "permission" simply means the geolocation API is available. */
export async function ensureLocationPermission(): Promise<boolean> {
  return getGeo() !== null;
}

export async function getCurrentCoords(opts?: { timeoutMs?: number }): Promise<Coords | null> {
  const geo = getGeo();
  if (!geo) return null;
  const timeoutMs = opts?.timeoutMs ?? 10000;
  return new Promise<Coords | null>((resolve) => {
    try {
      geo.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: timeoutMs },
      );
    } catch {
      resolve(null);
    }
  });
}

export function openMapsDirections(destination: string): void {
  if (typeof window === 'undefined') return;
  // Same-tab: a `_blank` tab shows a blank white screen on mobile browsers
  // before Maps loads. Same-tab hands off to Maps immediately.
  window.location.href = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

export function openDirections(dest: Coords, _label?: string): void {
  openMapsDirections(`${dest.lat},${dest.lng}`);
}
