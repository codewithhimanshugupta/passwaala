import { api } from './api';
import type { Account, Address, ReferralInfo } from './types';

/**
 * Checkout data prefetch — warms ALL data the cart/checkout screen needs
 * while the customer is still browsing. Includes:
 *  - saved addresses
 *  - NearBaz Coin balance
 *  - pending cancel fee (blocks COD)
 *  - nearby shops for bulk order banner (keyed by shopId)
 *  - the full account + referral objects (so Profile renders instantly too)
 *
 * When the customer opens cart/profile, all of this is already in memory → instant render.
 */
export interface CheckoutData {
  addresses: Address[];
  coinBalance: number;
  pendingCancelFeePaise: number;
  account: Account | null;
  referral: ReferralInfo | null;
  nearbyShops: Array<{ id: string; name: string; city: string; latitude: number; longitude: number; distanceMeters: number }>;
  nearbyShopsForShopId: string | null;
  shopDeliveryAvailable: boolean;
  shopDeliveryShopId: string | null;
}

const TTL_MS = 60_000;
let cached: { data: CheckoutData; at: number } | null = null;
let inflight: Promise<CheckoutData> | null = null;

/** Kick off (or reuse) a background prefetch. Safe to call repeatedly. */
export function prefetchCheckout(shopId?: string | null): Promise<CheckoutData> {
  const now = Date.now();
  // Invalidate if shopId changed (different shop's nearby list needed)
  if (cached && now - cached.at < TTL_MS && cached.data.nearbyShopsForShopId === (shopId ?? null)) {
    return Promise.resolve(cached.data);
  }
  if (inflight) return inflight;
  inflight = (async () => {
    const [addresses, referral, account, nearby] = await Promise.all([
      api.addresses().then((l) => l as Address[]).catch(() => [] as Address[]),
      api.referralMe().then((r) => (r as ReferralInfo | null) ?? null).catch(() => null),
      api.me().then((a) => (a as Account | null) ?? null).catch(() => null),
      shopId
        ? api.nearbyShopsForBulk(shopId).then(r => r.items).catch(() => [])
        : Promise.resolve([] as CheckoutData['nearbyShops']),
    ]);
    const data: CheckoutData = {
      addresses,
      coinBalance: referral?.coinBalance ?? 0,
      pendingCancelFeePaise: (account as { pendingCancelFeePaise?: number } | null)?.pendingCancelFeePaise ?? 0,
      account,
      referral,
      nearbyShops: nearby,
      nearbyShopsForShopId: shopId ?? null,
      shopDeliveryAvailable: true,
      shopDeliveryShopId: null,
    };
    cached = { data, at: Date.now() };
    inflight = null;
    return data;
  })();
  return inflight;
}

/** Read the prefetched data if still fresh, else null. */
export function getPrefetchedCheckout(): CheckoutData | null {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  return null;
}

/** Invalidate (e.g. after adding/deleting an address, or on logout). */
export function clearCheckoutPrefetch(): void {
  cached = null;
  inflight = null;
}
