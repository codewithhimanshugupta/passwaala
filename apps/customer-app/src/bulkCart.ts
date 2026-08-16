/**
 * Multi-shop cart store. Holds one LocalCart per shopId in memory +
 * IndexedDB (key: nearbaz.customer.bulkcart). Automatically cleared
 * once a BulkOrder is placed.
 */
import { useSyncExternalStore } from 'react';
import { idbGet, idbSet } from './idbKv';

const STORAGE_KEY = 'nearbaz.customer.bulkcart';

export interface BulkLine {
  productId: string;
  name: string;
  unitPricePaise: number;
  qty: number;
  imageUrl?: string | null;
}

export interface ShopCart {
  shopId: string;
  shopName: string;
  lines: BulkLine[];
}

type BulkCartState = ShopCart[];

const EMPTY: BulkCartState = [];

function loadSync(): BulkCartState {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as BulkCartState;
    }
  } catch { /* ignore */ }
  return [];
}

let state: BulkCartState = loadSync();
const listeners = new Set<() => void>();
let version = 0;
let cached: BulkCartState = state;

function persist() {
  version++;
  cached = [...state];
  for (const l of listeners) l();
  void idbSet(STORAGE_KEY, state);
}

export function bulkCartAddOne(
  productId: string,
  info: { shopId: string; shopName: string; name: string; unitPricePaise: number; imageUrl?: string | null },
): void {
  let shop = state.find((s) => s.shopId === info.shopId);
  if (!shop) {
    shop = { shopId: info.shopId, shopName: info.shopName, lines: [] };
    state = [...state, shop];
  } else {
    state = state.map((s) => (s.shopId === info.shopId ? { ...s } : s));
    shop = state.find((s) => s.shopId === info.shopId)!;
  }
  const line = shop.lines.find((l) => l.productId === productId);
  if (line) {
    line.qty += 1;
  } else {
    shop.lines.push({ productId, name: info.name, unitPricePaise: info.unitPricePaise, qty: 1, imageUrl: info.imageUrl ?? null });
  }
  persist();
}

export function bulkCartSetQty(shopId: string, productId: string, qty: number): void {
  state = state
    .map((s) => {
      if (s.shopId !== shopId) return s;
      const lines = qty <= 0
        ? s.lines.filter((l) => l.productId !== productId)
        : s.lines.map((l) => l.productId === productId ? { ...l, qty } : l);
      return { ...s, lines };
    })
    .filter((s) => s.lines.length > 0);
  persist();
}

/**
 * Decrement one unit, reading the CURRENT stored qty (not a render-captured
 * value). Race-safe: a stale captured qty or rapid double-tap can never wrap
 * back up or re-add a removed line. Removes the line (and empty shop) at 0.
 */
export function bulkCartDecOne(shopId: string, productId: string): void {
  const shop = state.find((s) => s.shopId === shopId);
  const line = shop?.lines.find((l) => l.productId === productId);
  const nextQty = line ? line.qty - 1 : 0;
  bulkCartSetQty(shopId, productId, nextQty);
}

export function bulkCartRemoveShop(shopId: string): void {
  state = state.filter((s) => s.shopId !== shopId);
  persist();
}

export function resetBulkCartStore(): void {
  state = [];
  persist();
}

export function useBulkCart() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => cached,
    () => cached,
  );
}

export function currentBulkCartShops(): string[] {
  return state.map((s) => s.shopId);
}

// Hydrate from IDB on startup
void (async () => {
  try {
    const stored = await idbGet<BulkCartState>(STORAGE_KEY);
    if (stored && Array.isArray(stored) && stored.length > 0 && state.length === 0) {
      state = stored;
      cached = [...state];
      for (const l of listeners) l();
    }
  } catch { /* ignore */ }
})();
