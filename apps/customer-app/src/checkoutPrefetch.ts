import { api } from './api';
import type { Address } from './types';

/**
 * Checkout data prefetch — warms the data the cart/checkout screen needs
 * (saved addresses + PassWaala Coin balance) WHILE the customer is still
 * browsing/adding on the shop screen. When they hit checkout, these are already
 * in memory so the cart renders instantly instead of firing fresh requests.
 *
 * Delivery fee + available offers still come from the authoritative cart sync
 * (they depend on the exact cart/shop/fulfilment), but addresses + coins are
 * independent and safe to pre-warm here.
 */
export interface CheckoutData {
  addresses: Address[];
  coinBalance: number;
}

const TTL_MS = 60_000;
let cached: { data: CheckoutData; at: number } | null = null;
let inflight: Promise<CheckoutData> | null = null;

/** Kick off (or reuse) a background prefetch. Safe to call repeatedly. */
export function prefetchCheckout(): Promise<CheckoutData> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return Promise.resolve(cached.data);
  if (inflight) return inflight;
  inflight = (async () => {
    const [addresses, referral] = await Promise.all([
      api.addresses().then((l) => l as Address[]).catch(() => [] as Address[]),
      api.referralMe().then((r) => r?.coinBalance ?? 0).catch(() => 0),
    ]);
    const data: CheckoutData = { addresses, coinBalance: referral };
    cached = { data, at: Date.now() };
    inflight = null;
    return data;
  })();
  return inflight;
}

/** Read the prefetched data if still fresh, else null (caller fetches normally). */
export function getPrefetchedCheckout(): CheckoutData | null {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  return null;
}

/** Invalidate (e.g. after adding/deleting an address, or on logout). */
export function clearCheckoutPrefetch(): void {
  cached = null;
  inflight = null;
}
