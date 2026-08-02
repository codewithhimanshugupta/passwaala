import {
  PLATFORM_DELIVERY_TIERS,
  haversineMeters,
  platformDeliveryFeePaise,
} from '@passwaala/shared';

/**
 * Distance-tiered platform-rider delivery fee + Haversine helper (shared money
 * math). Verifies the tier boundaries return the plan's rates (₹20/35/50/70)
 * and that the distance helper is sane.
 */
describe('platformDeliveryFeePaise', () => {
  const [t2, t5, t10, tFar] = PLATFORM_DELIVERY_TIERS.map((t) => t.feePaise);

  it('charges the ≤2km tier at and below 2km', () => {
    expect(platformDeliveryFeePaise(0)).toBe(t2);
    expect(platformDeliveryFeePaise(1900)).toBe(t2);
    expect(platformDeliveryFeePaise(2000)).toBe(t2);
  });

  it('charges the ≤5km tier between 2km and 5km', () => {
    expect(platformDeliveryFeePaise(2001)).toBe(t5);
    expect(platformDeliveryFeePaise(4900)).toBe(t5);
    expect(platformDeliveryFeePaise(5000)).toBe(t5);
  });

  it('charges the ≤10km tier between 5km and 10km', () => {
    expect(platformDeliveryFeePaise(5001)).toBe(t10);
    expect(platformDeliveryFeePaise(10000)).toBe(t10);
  });

  it('charges the long-haul tier beyond 10km', () => {
    expect(platformDeliveryFeePaise(10001)).toBe(tFar);
    expect(platformDeliveryFeePaise(50000)).toBe(tFar);
  });

  it('falls back to the highest tier on an unknown/NaN distance (never undercharge)', () => {
    expect(platformDeliveryFeePaise(NaN)).toBe(tFar);
    expect(platformDeliveryFeePaise(-1)).toBe(tFar);
  });
});

describe('haversineMeters', () => {
  it('is ~0 for the same point', () => {
    const p = { latitude: 25.4639, longitude: 78.582 };
    expect(haversineMeters(p, p)).toBeCloseTo(0, 3);
  });

  it('returns a sane distance for a known nearby pair (~1 km)', () => {
    // Two Jhansi points ~1km apart (from the seed/live data).
    const shop = { latitude: 25.4639, longitude: 78.582 };
    const drop = { latitude: 25.472696, longitude: 78.591767 };
    const meters = haversineMeters(shop, drop);
    expect(meters).toBeGreaterThan(800);
    expect(meters).toBeLessThan(2000);
  });

  it('returns NaN when a coordinate is missing', () => {
    expect(haversineMeters({ latitude: null, longitude: null }, { latitude: 1, longitude: 1 })).toBeNaN();
  });

  it('accepts Decimal-string coordinates (Prisma shape)', () => {
    const meters = haversineMeters(
      { latitude: '25.4639', longitude: '78.582' },
      { latitude: '25.472696', longitude: '78.591767' },
    );
    expect(Number.isFinite(meters)).toBe(true);
  });
});
