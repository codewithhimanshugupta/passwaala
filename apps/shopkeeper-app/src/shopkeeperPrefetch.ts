import { api } from './api';
import { ACTIVE_PARAM, ACTIVE_LIMIT } from './screens/OrderFeedScreen';

/**
 * Shopkeeper prefetch — warms every tab's data on app open so tapping Orders /
 * Products / Dashboard / Ledger / Settings renders instantly instead of
 * spinning. One parallel pass fills a short-lived cache the screens seed their
 * initial state from (and then revalidate silently in the background).
 *
 * Keyed by the active shop + the all-shops view flag, so a shop switch / view
 * change re-warms cleanly (callers invalidate via clearShopkeeperPrefetch).
 */
type FeedPage = Awaited<ReturnType<typeof api.orderFeed>>;
type Counts = Awaited<ReturnType<typeof api.orderFeedCounts>>;
type Products = Awaited<ReturnType<typeof api.myProducts>>;
type Categories = Awaited<ReturnType<typeof api.myCategories>>;
type Stats = Awaited<ReturnType<typeof api.shopStats>>;
type Ledger = Awaited<ReturnType<typeof api.myLedger>>;
type Pnl = Awaited<ReturnType<typeof api.myPnl>>;
type Me = Awaited<ReturnType<typeof api.me>>;
type Cities = Awaited<ReturnType<typeof api.serviceableCities>>;
type OfferStats = Awaited<ReturnType<typeof api.myOfferStats>>;

export interface ShopkeeperData {
  shopId: string;
  allShops: boolean;
  at: number;
  activeOrders: FeedPage | null;
  counts: Counts | null;
  products: Products | null;
  categories: Categories | null;
  stats: Stats | null;
  ledger: Ledger | null;
  pnl: Pnl | null;
  me: Me | null;
  cities: Cities | null;
  offerStats: OfferStats | null;
}

const TTL_MS = 60_000;
const LEDGER_PAGE = 20;

let cache: ShopkeeperData | null = null;
let inflight: Promise<void> | null = null;

/** Kick off (or reuse) a background prefetch for the active shop + view. */
export function prefetchShopkeeper(shopId: string, allShops: boolean): Promise<void> {
  if (cache && cache.shopId === shopId && cache.allShops === allShops && Date.now() - cache.at < TTL_MS) {
    return Promise.resolve();
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [activeOrders, counts, products, categories, stats, ledger, pnl, me, cities, offerStats] = await Promise.all([
        (allShops ? api.orderFeedAll(ACTIVE_PARAM, { limit: ACTIVE_LIMIT }) : api.orderFeed(ACTIVE_PARAM, { limit: ACTIVE_LIMIT })).catch(() => null),
        (allShops ? api.orderFeedAllCounts() : api.orderFeedCounts()).catch(() => null),
        api.myProducts().catch(() => null),
        api.myCategories().catch(() => null),
        api.shopStats().catch(() => null),
        api.myLedger({ limit: LEDGER_PAGE }).catch(() => null),
        api.myPnl().catch(() => null),
        api.me().catch(() => null),
        api.serviceableCities().catch(() => null),
        api.myOfferStats().catch(() => null),
      ]);
      cache = {
        shopId, allShops, at: Date.now(),
        activeOrders, counts, products, categories, stats, ledger, pnl, me, cities, offerStats,
      };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Read the whole prefetch bundle if still fresh, else null. Screens verify the
 * shopId / allShops match their own context before seeding from it. */
export function getShopkeeperPrefetch(): ShopkeeperData | null {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  return null;
}

/** Invalidate (on shop switch, view change, or logout / session expiry). */
export function clearShopkeeperPrefetch(): void {
  cache = null;
  inflight = null;
}
