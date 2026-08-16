import { api } from './api';
import type { RiderJob, BulkRiderJob, RiderMe } from './types';

/**
 * Rider prefetch — warms every screen's data on app open so tapping Home /
 * Jobs / Deliveries / Earnings / Dues renders instantly instead of spinning.
 *
 * Three caches behind one prefetch pass:
 *  - `me`      → riderMe (shared by Home, Earnings, Dues — one call, not three)
 *  - `jobs`    → available + active jobs (only when the rider is online)
 *  - `history` → first page of delivery history (Deliveries tab)
 *
 * Mirrors the customer app's prefetch pattern: short TTL + in-flight dedupe +
 * synchronous getters the screens seed their initial state from.
 */
export interface RiderJobsData {
  jobs: RiderJob[];
  bulkJobs: BulkRiderJob[];
  active: RiderJob[];
  activeBulk: BulkRiderJob[];
}

export interface RiderHistoryData {
  orders: RiderJob[];
  ordersNextCursor: string | null;
  bulkOrders: BulkRiderJob[];
}

const TTL_MS = 60_000;
const HISTORY_PAGE = 20;

let meCache: { data: RiderMe; at: number } | null = null;
let jobsCache: { data: RiderJobsData; at: number } | null = null;
let historyCache: { data: RiderHistoryData; at: number } | null = null;
let inflight: Promise<void> | null = null;

function fresh<T>(c: { data: T; at: number } | null): T | null {
  return c && Date.now() - c.at < TTL_MS ? c.data : null;
}

/**
 * Kick off (or reuse) a background prefetch. Fetches riderMe first (it tells us
 * whether the rider is online → whether to fetch jobs), then jobs + history in
 * parallel. Safe to call repeatedly; every call resolves once caches are warm.
 */
export function prefetchRider(): Promise<void> {
  if (fresh(meCache) && fresh(historyCache)) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const me = fresh(meCache) ?? (await api.riderMe().catch(() => null));
      if (me) meCache = { data: me, at: Date.now() };
      await Promise.all([
        // Jobs are only offered to online riders — skip the calls when offline.
        me?.online
          ? (async () => {
              const [available, mine] = await Promise.all([
                (api.riderJobs() as unknown as Promise<{ orders: RiderJob[]; bulkOrders: BulkRiderJob[] }>).catch(() => ({ orders: [], bulkOrders: [] })),
                (api.riderDeliveries() as unknown as Promise<{ orders: RiderJob[]; bulkOrders: BulkRiderJob[] }>).catch(() => ({ orders: [], bulkOrders: [] })),
              ]);
              jobsCache = {
                data: {
                  jobs: available.orders ?? [],
                  bulkJobs: available.bulkOrders ?? [],
                  active: mine.orders ?? [],
                  activeBulk: mine.bulkOrders ?? [],
                },
                at: Date.now(),
              };
            })()
          : Promise.resolve(),
        (async () => {
          const page = await (api.riderDeliveryHistory({ limit: HISTORY_PAGE }) as unknown as Promise<RiderHistoryData>).catch(
            () => ({ orders: [], ordersNextCursor: null, bulkOrders: [] } as RiderHistoryData),
          );
          historyCache = { data: page, at: Date.now() };
        })(),
      ]);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Read the prefetched riderMe if still fresh, else null. */
export function getPrefetchedRiderMe(): RiderMe | null {
  return fresh(meCache);
}

/** Seed the riderMe cache from an already-fetched profile (e.g. bootstrap
 * resolveRider) so the follow-up prefetch skips a duplicate riderMe call. */
export function seedRiderMe(me: RiderMe): void {
  meCache = { data: me, at: Date.now() };
}

/** Read the prefetched jobs if still fresh, else null. */
export function getPrefetchedJobs(): RiderJobsData | null {
  return fresh(jobsCache);
}

/** Read the prefetched delivery history if still fresh, else null. */
export function getPrefetchedHistory(): RiderHistoryData | null {
  return fresh(historyCache);
}

/** Invalidate everything (e.g. on logout / session expiry). */
export function clearRiderPrefetch(): void {
  meCache = null;
  jobsCache = null;
  historyCache = null;
  inflight = null;
}
