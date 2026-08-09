/**
 * Client-side cart store. Add/remove/qty changes are INSTANT and local
 * (persisted to localStorage) — no backend call per tap, which is what made the
 * old server-cart feel slow. The server cart is only touched once, at checkout,
 * via syncToServer(): we push the local lines to the server so the existing
 * bill/placement flow (which reads the server cart) works unchanged.
 *
 * A local cart is single-shop like the server: adding from a different shop
 * prompts the caller to clear first (isDifferentShopError stays for CartScreen).
 */
import { useSyncExternalStore } from 'react';
import { ApiError } from '@passwaala/api-client';
import { api } from './api';
import { idbGet, idbSet } from './idbKv';
import type { Cart } from './types';

const STORAGE_KEY = 'passwaala.customer.cart';

/** A locally-held cart line — enough to render + to sync to the server. */
export interface LocalLine {
  productId: string;
  name: string;
  unitPricePaise: number;
  qty: number;
  imageUrl?: string | null;
}
interface LocalCart {
  shopId: string | null;
  shopName: string | null;
  lines: LocalLine[];
}

const EMPTY: LocalCart = { shopId: null, shopName: null, lines: [] };

/**
 * Synchronous startup read from the localStorage MIRROR (idbSet keeps it in
 * sync). This gives useCart() data on the very first render without awaiting
 * IndexedDB; hydrateFromIdb() below then reconciles with the durable IDB copy.
 */
function load(): LocalCart {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as LocalCart;
    }
  } catch {
    /* ignore */
  }
  return { ...EMPTY };
}

let local: LocalCart = load();
const listeners = new Set<() => void>();
let version = 0; // bumps on every change so useSyncExternalStore re-reads
// Once any local mutation runs, the in-memory state is authoritative. This flag
// prevents hydrateFromIdb() from overwriting a user-initiated cart change with a
// stale IDB snapshot that hasn't been flushed yet (the IDB write is fire-and-forget).
let didMutate = false;

/**
 * Durable persistence lives in IndexedDB (idbSet also mirrors to localStorage
 * for the sync startup read). Async + fire-and-forget so cart mutations stay
 * instant; the in-memory `local` is the source of truth for the UI.
 */
function persist() {
  didMutate = true;
  version += 1;
  cached = snapshot();
  for (const l of listeners) l();
  void idbSet(STORAGE_KEY, local);
}

/**
 * Hydrate from the durable IndexedDB copy on startup. If IDB holds a cart the
 * synchronous localStorage read missed (e.g. mirror cleared but IDB intact),
 * adopt it and notify subscribers. Called once at module init.
 *
 * Skipped if any mutation has already run — the in-memory state is newer than
 * what IDB holds and we must not clobber it with a stale IDB read.
 */
async function hydrateFromIdb(): Promise<void> {
  try {
    const stored = await idbGet<LocalCart>(STORAGE_KEY);
    if (!didMutate && stored && stored.lines && stored.lines.length > 0 && local.lines.length === 0) {
      local = stored;
      version += 1;
      cached = snapshot();
      for (const l of listeners) l();
    }
  } catch {
    /* ignore */
  }
}
void hydrateFromIdb();

/** Add one unit of a product (from a given shop). Throws DifferentShopError
 * (409-shaped) if the cart already holds another shop's items. */
export async function addOne(
  productId: string,
  info?: { shopId: string; shopName?: string; name: string; unitPricePaise: number; imageUrl?: string | null },
): Promise<void> {
  if (info && local.shopId && local.shopId !== info.shopId && local.lines.length > 0) {
    throw new ApiError(409, 'Your cart has items from another shop. Clear it to start a new cart.');
  }
  if (info && !local.shopId) {
    local.shopId = info.shopId;
    local.shopName = info.shopName ?? null;
  }
  const line = local.lines.find((l) => l.productId === productId);
  if (line) {
    line.qty += 1;
  } else if (info) {
    local.lines.push({ productId, name: info.name, unitPricePaise: info.unitPricePaise, qty: 1, imageUrl: info.imageUrl ?? null });
  }
  persist();
}

/** Set an explicit quantity (0 removes the line). */
export async function setQty(productId: string, qty: number): Promise<void> {
  if (qty <= 0) {
    local.lines = local.lines.filter((l) => l.productId !== productId);
  } else {
    const line = local.lines.find((l) => l.productId === productId);
    if (line) line.qty = qty;
  }
  // Decrementing the last item empties the cart entirely — reset local state AND
  // clear BOTH server cart and IndexedDB so a page reload never restores the old items.
  if (local.lines.length === 0) {
    local = { ...EMPTY };
    // Clear IDB immediately so hydrateFromIdb() on next load finds nothing
    void idbSet(STORAGE_KEY, null);
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    void api.clearCart().catch(() => undefined);
    local = { ...EMPTY };
    void api.clearCart().catch(() => undefined);
  }
  persist();
}

/**
 * Decrement one unit of a product, reading the CURRENT stored qty (not a value
 * captured at render time). This makes the "−" button race-safe: a stale
 * captured qty or a rapid double-tap can never wrap back up or re-add a removed
 * line — the source of truth is always the live store. Removes the line at 0.
 */
export async function decOne(productId: string): Promise<void> {
  const line = local.lines.find((l) => l.productId === productId);
  const nextQty = line ? line.qty - 1 : 0;
  await setQty(productId, nextQty);
}

/** Clear the whole cart, then optionally start fresh with a product. */
export async function clearCart(thenAdd?: { productId: string; shopId: string; shopName?: string; name: string; unitPricePaise: number; imageUrl?: string | null }): Promise<void> {
  local = { ...EMPTY, lines: [] };
  if (thenAdd) {
    local.shopId = thenAdd.shopId;
    local.shopName = thenAdd.shopName ?? null;
    local.lines = [{ productId: thenAdd.productId, name: thenAdd.name, unitPricePaise: thenAdd.unitPricePaise, qty: 1, imageUrl: thenAdd.imageUrl ?? null }];
  }
  persist();
}

/** True when an error is the single-shop-cart 409 conflict. */
export function isDifferentShopError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}

/**
 * Push the local cart to the SERVER cart so the existing bill/placement flow
 * works. Called once when the Cart screen opens (and before placing). Clears the
 * server cart then re-adds the local lines. Returns the fresh server Cart (with
 * the authoritative bill). No-op-safe when the local cart is empty.
 */
export async function syncToServer(opts: { deliveryMode?: string; addressId?: string; selectedOfferId?: string } = {}): Promise<Cart> {
  if (!local.shopId || local.lines.length === 0) {
    // Nothing local — just clear the server cart and return empty.
    try { await api.clearCart(); } catch { /* ignore */ }
    return { empty: true, items: [] } as Cart;
  }
  // ONE round-trip: replace the whole server cart (shop + all lines) and get the
  // authoritative bill back. Previously this did clear + one add-per-line + GET
  // (N+2 heavy calls, ~9s each on the free tier) — this collapses it to one.
  const cart = (await api.replaceCart({
    shopId: local.shopId,
    items: local.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
    deliveryMode: opts.deliveryMode,
    addressId: opts.addressId,
    selectedOfferId: opts.selectedOfferId,
  })) as Cart;
  return cart;
}

/** The local cart shop id (for the storefront to know which shop is active). */
export function currentCartShopId(): string | null {
  return local.shopId;
}

/**
 * Pull the SERVER cart into the local cart (used after server-side operations
 * like reorder that populate the server cart). Overwrites local lines.
 */
export async function loadFromServer(): Promise<void> {
  try {
    const cart = (await api.cart()) as Cart & {
      shop?: { id: string; name?: string };
      items?: Array<{ productId: string; name: string; unitPricePaise: number; qty: number }>;
    };
    if (cart.empty || !cart.shop || !cart.items?.length) {
      local = { ...EMPTY, lines: [] };
    } else {
      local = {
        shopId: cart.shop.id,
        shopName: cart.shop.name ?? null,
        lines: cart.items.map((it) => ({
          productId: it.productId,
          name: it.name,
          unitPricePaise: it.unitPricePaise,
          qty: it.qty,
        })),
      };
    }
    persist();
  } catch {
    /* ignore — keep whatever is local */
  }
}

export interface CartSnapshot {
  itemCount: number;
  totalPaise: number; // LOCAL subtotal (bill is computed at checkout via syncToServer)
  qtyByProduct: Record<string, number>;
  shopId: string | null;
  shopName: string | null;
  lines: LocalLine[];
}

function snapshot(): CartSnapshot {
  const qtyByProduct: Record<string, number> = {};
  let itemCount = 0;
  let totalPaise = 0;
  for (const l of local.lines) {
    qtyByProduct[l.productId] = l.qty;
    itemCount += l.qty;
    totalPaise += l.unitPricePaise * l.qty;
  }
  return { itemCount, totalPaise, qtyByProduct, shopId: local.shopId, shopName: local.shopName, lines: local.lines };
}

let cached: CartSnapshot = snapshot();
function getSnapshot(): CartSnapshot {
  return cached;
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useCart(): CartSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Reset local cart (e.g. on logout). */
export function resetCartStore(): void {
  local = { ...EMPTY, lines: [] };
  persist();
}
