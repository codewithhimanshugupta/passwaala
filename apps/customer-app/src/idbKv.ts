/**
 * idbKv — a minimal async key/value store backed by IndexedDB, with a
 * localStorage fallback (private mode / unsupported browsers). Used to persist
 * the customer cart off the main-thread-blocking localStorage path.
 *
 * IndexedDB is async-only, so callers that need a value synchronously at startup
 * (e.g. first render) should keep a localStorage mirror for the instant read and
 * treat IDB as the durable store that hydrates shortly after.
 */
const DB_NAME = 'passwaala';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Read a value (parsed JSON) by key. Falls back to localStorage. */
export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (db) {
    const val = await new Promise<unknown>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (val != null) return val as T;
  }
  // Fallback: localStorage mirror.
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    }
  } catch { /* ignore */ }
  return null;
}

/** Write a value by key (also mirrors to localStorage for the sync-startup read). */
export async function idbSet<T>(key: string, value: T): Promise<void> {
  // Keep a localStorage mirror so a synchronous startup read still works.
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Delete a key from both IndexedDB and the localStorage mirror. */
export async function idbDel(key: string): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch { /* ignore */ }
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
