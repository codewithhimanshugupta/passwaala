/**
 * A tiny module-level cart store so any screen (storefront, cart, tab bar) reads
 * the SAME server-authoritative cart without prop drilling. The server is the
 * source of truth: every mutation re-fetches GET /cart and publishes the result
 * to subscribers. React components subscribe via useCart().
 */
import { useSyncExternalStore } from 'react';
import { ApiError } from '@passwaala/api-client';
import { api } from './api';
import type { Cart } from './types';

const EMPTY_CART: Cart = { empty: true, items: [] };

let current: Cart = EMPTY_CART;
let loading = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(cart: Cart) {
  current = cart ?? EMPTY_CART;
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Re-fetch the authoritative cart from the server. Pass `deliveryMode`/
 * `addressId` to preview the exact delivery fee for that fulfilment choice
 * (distance-tiered for a platform-rider delivery).
 */
export async function refreshCart(opts: { deliveryMode?: string; addressId?: string; selectedOfferId?: string } = {}): Promise<Cart> {
  loading = true;
  emit();
  try {
    const cart = (await api.cart(opts)) as Cart;
    set(cart);
    return cart;
  } finally {
    loading = false;
    emit();
  }
}

/**
 * Add one unit of a product. Returns the fresh cart. On the single-shop 409 we
 * throw the ApiError so callers can offer "Clear cart & add".
 */
export async function addOne(productId: string): Promise<Cart> {
  await api.addToCart(productId, 1);
  return refreshCart();
}

/** Set an explicit quantity (0 removes the line). Returns the fresh cart. */
export async function setQty(productId: string, qty: number): Promise<Cart> {
  await api.setCartQty(productId, qty);
  return refreshCart();
}

/** Clear the whole cart, then optionally add a product to start fresh. */
export async function clearCart(thenAddProductId?: string): Promise<Cart> {
  await api.clearCart();
  if (thenAddProductId) {
    await api.addToCart(thenAddProductId, 1);
  }
  return refreshCart();
}

/** True when an error is the single-shop-cart 409 conflict. */
export function isDifferentShopError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}

export interface CartSnapshot {
  cart: Cart;
  loading: boolean;
  itemCount: number;
  totalPaise: number;
  /** Per-product quantity map derived from the server cart. */
  qtyByProduct: Record<string, number>;
}

function snapshot(): CartSnapshot {
  const qtyByProduct: Record<string, number> = {};
  let itemCount = 0;
  for (const it of current.items) {
    qtyByProduct[it.productId] = it.qty;
    itemCount += it.qty;
  }
  return {
    cart: current,
    loading,
    itemCount,
    totalPaise: current.bill?.totalPaise ?? 0,
    qtyByProduct,
  };
}

// useSyncExternalStore needs a stable snapshot reference between emits, so we
// memoize until something actually changes.
let cached: CartSnapshot = snapshot();
let cachedFor: Cart | null = null;
let cachedLoading = loading;
function getSnapshot(): CartSnapshot {
  if (cachedFor !== current || cachedLoading !== loading) {
    cached = snapshot();
    cachedFor = current;
    cachedLoading = loading;
  }
  return cached;
}

/** Subscribe a component to the shared cart. */
export function useCart(): CartSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Reset local cart state (e.g. on logout). Does not hit the server. */
export function resetCartStore(): void {
  set(EMPTY_CART);
}
