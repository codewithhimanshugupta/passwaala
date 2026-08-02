import { Injectable } from '@nestjs/common';

/**
 * MemoryCache — a tiny in-process TTL cache for hot read endpoints (nearby
 * shops, product catalogs, categories, serviceable cities). No Redis needed at
 * pilot scale: a single API instance serves reads from memory for a few seconds,
 * cutting repeated DB round-trips on a slow/free-tier database.
 *
 * NOT for per-user or write-sensitive data. Entries auto-expire; a manual
 * invalidate() clears keys by prefix when the underlying data changes.
 *
 * Trade-off: on a multi-instance deploy each instance has its own cache, so a
 * write on instance A isn't seen by B until its TTL lapses. Fine for short TTLs
 * on public catalog reads; move to Redis when you run >1 instance.
 */
@Injectable()
export class MemoryCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();

  /** Get a cached value, or compute+store it via `factory` if missing/expired. */
  async wrap<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value as T;
    }
    const value = await factory();
    this.store.set(key, { value, expiresAt: now + ttlMs });
    return value;
  }

  /** Drop a single key. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Drop every key starting with `prefix` (e.g. on a write that changes it). */
  invalidatePrefix(prefix: string): void {
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }

  /** Clear everything (rarely needed). */
  clear(): void {
    this.store.clear();
  }
}
