/**
 * Browser system notifications for order updates in the customer app.
 * Fires when the tab is backgrounded so the customer knows without watching
 * the screen. Graceful no-op on native / unsupported browsers.
 */

interface MinimalNotificationOptions {
  body?: string;
  tag?: string;
  renotify?: boolean;
}
interface MinimalNotificationCtor {
  new (title: string, options?: MinimalNotificationOptions): unknown;
  permission: string;
  requestPermission: () => Promise<string>;
}

function getNotification(): MinimalNotificationCtor | null {
  const g = globalThis as unknown as { Notification?: MinimalNotificationCtor };
  return g.Notification ?? null;
}

function isTabHidden(): boolean {
  const doc = (globalThis as unknown as { document?: { hidden?: boolean } }).document;
  return doc?.hidden === true;
}

export async function requestNotifyPermission(): Promise<string> {
  const N = getNotification();
  if (!N) return 'unsupported';
  try { return await N.requestPermission(); } catch { return 'denied'; }
}

export function canNotify(): boolean {
  const N = getNotification();
  return !!N && N.permission === 'granted';
}

/** Fire a notification — always fires (foreground + background) for order events. */
export function notifyOrderUpdate(title: string, body: string, tag: string): void {
  const N = getNotification();
  if (!N || N.permission !== 'granted') return;
  try {
    new N(title, { body, tag, renotify: true });
  } catch { /* ignore */ }
}
