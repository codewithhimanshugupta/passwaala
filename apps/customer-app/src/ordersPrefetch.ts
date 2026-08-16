import { api } from './api';
import type { OrderHistoryItem, BulkOrderSummary } from './types';

/**
 * Orders prefetch — warms the Orders tab (ongoing + first page of history + first
 * page of bulk) on app open, so tapping "Orders" renders instantly instead of
 * showing skeletons while three requests fly. Mirrors checkoutPrefetch: a short
 * TTL + in-flight dedupe + a synchronous getter the screen seeds its state from.
 */
export interface OrdersData {
  ongoing: OrderHistoryItem[];
  history: OrderHistoryItem[];
  historyCursor: string | null;
  bulk: BulkOrderSummary[];
  bulkCursor: string | null;
}

type Page<T> = { items: T[]; nextCursor: string | null };
const EMPTY: Page<never> = { items: [], nextCursor: null };

const TTL_MS = 60_000;
const ONGOING_LIMIT = 50;
const HISTORY_PAGE = 5;
const BULK_PAGE = 5;

let cached: { data: OrdersData; at: number } | null = null;
let inflight: Promise<OrdersData> | null = null;

/** Kick off (or reuse) a background prefetch. Safe to call repeatedly. */
export function prefetchOrders(): Promise<OrdersData> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.data);
  if (inflight) return inflight;
  inflight = (async () => {
    const [ongoing, history, bulk] = await Promise.all([
      (api.orderHistory({ limit: ONGOING_LIMIT, mode: 'ongoing' }) as Promise<Page<OrderHistoryItem>>).catch(() => EMPTY as Page<OrderHistoryItem>),
      (api.orderHistory({ limit: HISTORY_PAGE, mode: 'history' }) as Promise<Page<OrderHistoryItem>>).catch(() => EMPTY as Page<OrderHistoryItem>),
      (api.bulkOrderHistory({ limit: BULK_PAGE }) as Promise<Page<BulkOrderSummary>>).catch(() => EMPTY as Page<BulkOrderSummary>),
    ]);
    const data: OrdersData = {
      ongoing: ongoing.items,
      history: history.items,
      historyCursor: history.nextCursor,
      bulk: bulk.items,
      bulkCursor: bulk.nextCursor,
    };
    cached = { data, at: Date.now() };
    inflight = null;
    return data;
  })();
  return inflight;
}

/** Read the prefetched orders if still fresh, else null. */
export function getPrefetchedOrders(): OrdersData | null {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  return null;
}

/** Invalidate (e.g. after placing/cancelling an order, or on logout). */
export function clearOrdersPrefetch(): void {
  cached = null;
  inflight = null;
}
