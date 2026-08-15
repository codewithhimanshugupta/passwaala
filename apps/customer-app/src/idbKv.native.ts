/**
 * NATIVE variant of idbKv.ts (Metro picks `.native.ts` on iOS/Android; the web
 * build keeps the IndexedDB implementation in idbKv.ts). Backed by
 * AsyncStorage, which is durable across app restarts on device.
 *
 * Same async signatures as the web version (idbGet/idbSet/idbDel), so cart.ts,
 * bulkCart.ts and the delivery-location store work unchanged. The synchronous
 * startup reads in those modules use `localStorage`, which is undefined on
 * native — so they start empty and these async hydrators fill them in shortly
 * after, exactly like the web IndexedDB hydrate path.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Read a value (parsed JSON) by key. */
export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Write a value by key (JSON-serialised). */
export async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Delete a key. */
export async function idbDel(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
