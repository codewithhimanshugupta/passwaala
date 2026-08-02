/**
 * Web-only browser system notifications for new delivery jobs. These alert the
 * rider even when the tab is backgrounded (on another tab/app). When the tab IS
 * focused we rely on the in-app banner + looping sound instead, so we don't
 * double-alert. Native is a graceful no-op (guarded on the absence of the
 * Notification / document globals).
 */

/** Minimal structural types so we don't depend on DOM lib type declarations. */
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

/** The Notification constructor if the browser exposes one, else null. */
function getNotification(): MinimalNotificationCtor | null {
  const g = globalThis as unknown as { Notification?: MinimalNotificationCtor };
  return g.Notification ?? null;
}

/** True when the current tab/window is hidden (backgrounded). */
function isTabHidden(): boolean {
  const doc = (globalThis as unknown as { document?: { hidden?: boolean } }).document;
  return doc?.hidden === true;
}

/**
 * Ask the browser for notification permission. Must be called from a user
 * gesture (e.g. a button press) so the prompt appears. No-op off the web.
 */
export async function requestNotifyPermission(): Promise<string> {
  const N = getNotification();
  if (!N) return 'unsupported';
  try {
    return await N.requestPermission();
  } catch {
    return 'denied';
  }
}

/** Whether notifications are supported and already granted. */
export function canNotify(): boolean {
  const N = getNotification();
  return !!N && N.permission === 'granted';
}

/**
 * Fire a system notification for a new job — but ONLY when permission is granted
 * AND the tab is backgrounded. If the tab is focused we skip it and let the
 * in-app banner + sound handle the alert. Safe/no-op off the web.
 */
export function notifyNewJob(title: string, body: string): void {
  const N = getNotification();
  if (!N || N.permission !== 'granted') return;
  if (!isTabHidden()) return; // focused — the in-app banner + sound cover it
  try {
    // eslint-disable-next-line no-new
    new N(title, { body, tag: 'passwaala-job', renotify: true });
  } catch {
    /* ignore a single failed notification */
  }
}

/**
 * Fire a system notification for a new system alert (escalation / penalty).
 * Unlike jobs, we fire this even when the tab is focused — the in-app banner is
 * lightweight and there's no looping sound, so an OS notification is the primary
 * signal on any tab. No-op off the web / without permission.
 */
export function notifyAlert(title: string, body: string): void {
  const N = getNotification();
  if (!N || N.permission !== 'granted') return;
  try {
    // eslint-disable-next-line no-new
    new N(title, { body, tag: 'passwaala-alert', renotify: true });
  } catch {
    /* ignore a single failed notification */
  }
}

/**
 * Vibrate the device (mobile web / some browsers). Pattern is a strong buzz so
 * a new job is felt even in a pocket. Guarded — a graceful no-op where
 * navigator.vibrate is unavailable (desktop / native).
 */
export function vibrate(): void {
  const nav = (globalThis as unknown as { navigator?: { vibrate?: (p: number | number[]) => boolean } }).navigator;
  try {
    nav?.vibrate?.([400, 150, 400]);
  } catch {
    /* ignore */
  }
}
