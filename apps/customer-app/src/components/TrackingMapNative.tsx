/**
 * TrackingMapNative — WEB STUB. The real implementation lives in
 * `TrackingMapNative.native.tsx` (Metro loads that on iOS/Android). On web,
 * TrackingMap renders its Leaflet iframe (`WebMap`) and NEVER reaches this
 * component, so this stub only exists to keep the import resolvable without
 * pulling `react-native-maps` into the web bundle. It renders nothing.
 */
import type { Geo, TripPhase } from './TrackingMap';

export function TrackingMapNative(_props: {
  shop: Geo;
  drop: Geo;
  rider?: Geo | null;
  phase: TripPhase;
  extraShops?: Geo[];
  currentShopIndex?: number;
}) {
  return null;
}
