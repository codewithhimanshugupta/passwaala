/**
 * WEB variant of a tiny durable key-value store (Metro picks `kv.native.ts` on
 * iOS/Android; this file is used for the web build). Backed by localStorage,
 * which persists across tab reloads.
 *
 * Async signatures (kvGet/kvSet/kvDel) match the native AsyncStorage version so
 * the POS outbox + catalog cache work identically on web and device. Values are
 * JSON-serialised. All operations swallow errors (private-mode / quota) so a
 * storage failure never crashes the POS flow.
 */

/** Read a value (parsed JSON) by key; null when absent or unparseable. */
export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Write a value by key (JSON-serialised). */
export async function kvSet<T>(key: string, value: T): Promise<void> {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Delete a key. */
export async function kvDel(key: string): Promise<void> {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
