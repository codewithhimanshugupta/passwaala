import { MAX_DELIVERY_RADIUS_METERS, PLATFORM_DELIVERY_TIERS } from './constants';

/**
 * A geographic point. lat/lng may be a number, a Decimal-ish string (Prisma),
 * a Prisma `Decimal` object (has a `toString`), or null/undefined — everything
 * is funneled through `Number(...)`, so any value type is accepted here.
 */
export interface GeoPoint {
  latitude: unknown;
  longitude: unknown;
}

const EARTH_RADIUS_METRES = 6371000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Coerce a coordinate value to a finite number, or NaN if it's missing/blank.
 * Guards against `Number(null) === 0`, `Number('') === 0`, `Number('  ') === 0`,
 * `Number(false) === 0`, and `Number([]) === 0`, any of which would otherwise
 * turn a missing/blank coordinate into a valid (0,0) point off the coast of
 * Africa rather than failing safe. Only genuine numeric input passes.
 */
function coord(value: unknown): number {
  if (value === null || value === undefined || typeof value === 'boolean') return NaN;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  // Reject objects/arrays that aren't Decimal-like (no meaningful toString number).
  const n = Number(value as string | number);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Great-circle (Haversine) distance in metres between two points. Coordinates
 * may arrive as Decimal strings (Prisma) or numbers. Returns NaN if any
 * coordinate is missing/non-finite — callers treat NaN conservatively.
 * Pure function; no PostGIS needed for these small point-to-point checks.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const lat1 = coord(a.latitude);
  const lng1 = coord(a.longitude);
  const lat2 = coord(b.latitude);
  const lng2 = coord(b.longitude);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return NaN;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The platform-rider delivery fee (paise) for a shop→customer distance, per the
 * PLATFORM_DELIVERY_TIERS bands. Applies to PLATFORM_RIDER orders only (the
 * shop's flat fee covers self-delivery). A missing/NaN distance falls back to
 * the highest tier (conservative — never undercharge on unknown distance).
 */
export function platformDeliveryFeePaise(distanceMeters: number): number {
  const tiers = PLATFORM_DELIVERY_TIERS;
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return tiers[tiers.length - 1].feePaise;
  }
  for (const tier of tiers) {
    if (distanceMeters <= tier.maxMeters) return tier.feePaise;
  }
  return tiers[tiers.length - 1].feePaise;
}

/**
 * Whether a customer drop point is within a shop's serviceable delivery range.
 * Returns true only when both points are valid AND their great-circle distance
 * is at most `maxMeters` (default MAX_DELIVERY_RADIUS_METERS). A missing/invalid
 * coordinate returns false — we never deliver to an unknown location.
 */
export function isWithinDeliveryRange(
  shop: GeoPoint,
  drop: GeoPoint,
  maxMeters: number = MAX_DELIVERY_RADIUS_METERS,
): boolean {
  const meters = haversineMeters(shop, drop);
  if (!Number.isFinite(meters)) return false;
  return meters <= maxMeters;
}
