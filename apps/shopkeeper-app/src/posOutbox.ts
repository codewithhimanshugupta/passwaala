/**
 * Offline POS outbox — a durable queue of counter sales that could not be sent
 * to the server yet (device offline / API unreachable). Sales are rung up and
 * receipts printed locally *immediately*; the network write is decoupled and
 * replayed later. Exactly-once is guaranteed server-side by the sale's
 * `idempotencyKey` (a DB unique constraint), so replaying a queued body that
 * actually did commit is a safe no-op that returns the existing sale.
 *
 * Storage is via the durable kv abstraction (AsyncStorage on device,
 * localStorage on web), so a queued sale survives the app being killed while
 * still offline. This module holds NO reference to the api client — `flushOutbox`
 * takes a poster callback — to avoid an import cycle with src/api.ts.
 */
import { kvGet, kvSet } from './kv';
import type { POSCreateSale } from '@passwaala/shared';

/** Storage keys. Namespaced so multiple shops on one device don't collide. */
const OUTBOX_KEY = 'passwaala.shopkeeper.pos.outbox.v1';
const CATALOG_KEY = 'passwaala.shopkeeper.pos.catalog.v1';

/** One queued sale: the exact request body plus local bookkeeping. */
export interface OutboxEntry {
  /** Stable local id (for list keys / removal). */
  localId: string;
  /**
   * The shop this sale belongs to. The server takes shopId from the JWT (not
   * the body), so a queued sale must only be replayed while THIS shop's token
   * is active — otherwise it would land on whichever shop is currently active.
   * Flushing is therefore scoped by shopId.
   */
  shopId: string;
  /** The request body to POST /orders/pos (carries the idempotencyKey). */
  body: POSCreateSale;
  /** When it was rung up locally (ISO 8601). */
  createdAt: string;
  /** How many send attempts have been made (for surfacing stuck items). */
  attempts: number;
}

/** A product snapshot cached for offline catalog picking. */
export interface CachedProduct {
  id: string;
  name: string;
  pricePaise: number;
  available: boolean;
}

/** Generate a collision-resistant client id / idempotency key. */
export function newId(prefix = 'pos'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Read the raw outbox list (empty when none). */
export async function listOutbox(): Promise<OutboxEntry[]> {
  return (await kvGet<OutboxEntry[]>(OUTBOX_KEY)) ?? [];
}

/** Count of queued (unsent) sales — drives the "N pending sync" badge. When
 *  `shopId` is given, counts only that shop's entries. */
export async function outboxCount(shopId?: string): Promise<number> {
  const list = await listOutbox();
  return shopId ? list.filter((e) => e.shopId === shopId).length : list.length;
}

/** Append a sale to the outbox. Returns the created entry. */
export async function enqueueOutbox(shopId: string, body: POSCreateSale): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    localId: newId('obx'),
    shopId,
    body,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const list = await listOutbox();
  list.push(entry);
  await kvSet(OUTBOX_KEY, list);
  return entry;
}

/** Remove an entry by localId (after a successful send). */
async function removeOutbox(localId: string): Promise<void> {
  const list = await listOutbox();
  await kvSet(
    OUTBOX_KEY,
    list.filter((e) => e.localId !== localId),
  );
}

/** Bump the attempt counter on an entry (kept in the queue after a failed send). */
async function bumpAttempts(localId: string): Promise<void> {
  const list = await listOutbox();
  const next = list.map((e) => (e.localId === localId ? { ...e, attempts: e.attempts + 1 } : e));
  await kvSet(OUTBOX_KEY, next);
}

/** Result of a flush pass. */
export interface FlushResult {
  sent: number;
  remaining: number;
}

/**
 * Try to send queued sales via `poster`. Scoped to `shopId` so a sale only ever
 * replays while its own shop's token is active (the server derives shopId from
 * the JWT). A poster that throws `PosOfflineError` aborts the pass (still
 * offline) leaving the rest queued; any other error (server rejected the body)
 * bumps attempts and, after several tries, drops that one entry so it can't
 * wedge the queue forever.
 *
 * Runs sequentially (not parallel) so a flaky link doesn't fire a burst of
 * writes, and to preserve sale order.
 */
export async function flushOutbox(
  poster: (body: POSCreateSale) => Promise<unknown>,
  shopId: string,
): Promise<FlushResult> {
  let sent = 0;
  const all = await listOutbox();
  const mine = all.filter((e) => e.shopId === shopId);
  for (const entry of mine) {
    try {
      await poster(entry.body);
      await removeOutbox(entry.localId);
      sent += 1;
    } catch (err) {
      if (err instanceof PosOfflineError) {
        // Still offline — stop; the remaining entries stay queued for next time.
        break;
      }
      // Server rejected this body (e.g. a 4xx). Bump attempts; after several
      // tries drop it so one poison entry can't block the whole queue.
      await bumpAttempts(entry.localId);
      const fresh = (await listOutbox()).find((e) => e.localId === entry.localId);
      if (fresh && fresh.attempts >= 5) await removeOutbox(entry.localId);
    }
  }
  return { sent, remaining: await outboxCount(shopId) };
}

/**
 * PosOfflineError — thrown by the poster when the request could not reach the
 * server (network failure), signalling "queue it / stop flushing" rather than
 * "the sale was rejected".
 */
export class PosOfflineError extends Error {
  constructor(message = 'Offline — the sale was saved and will sync automatically.') {
    super(message);
    this.name = 'PosOfflineError';
  }
}

/** Persist the shop's catalog for offline picking (refreshed whenever online). */
export async function cacheCatalog(products: CachedProduct[]): Promise<void> {
  await kvSet(CATALOG_KEY, products);
}

/** Load the last-cached catalog (empty when never cached). */
export async function loadCachedCatalog(): Promise<CachedProduct[]> {
  return (await kvGet<CachedProduct[]>(CATALOG_KEY)) ?? [];
}
