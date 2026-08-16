/**
 * NATIVE variant of kv.ts (Metro picks `.native.ts` on iOS/Android; the web
 * build keeps the localStorage implementation in kv.ts). Backed by
 * AsyncStorage, which is durable across app restarts on device — this is what
 * makes the offline POS outbox survive the app being killed while offline.
 *
 * Same async signatures as the web version (kvGet/kvSet/kvDel).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Read a value (parsed JSON) by key; null when absent or unparseable. */
export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Write a value by key (JSON-serialised). */
export async function kvSet<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Delete a key. */
export async function kvDel(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
