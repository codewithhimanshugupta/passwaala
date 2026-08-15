/**
 * NATIVE (iOS/Android) system notifications for new orders. Metro picks this
 * `.native.ts` on native; the web build keeps notify.ts (browser Notification
 * API). Mirrors the web semantics: only fire an OS notification when the app is
 * backgrounded — when it's foregrounded the in-app banner + looping sound cover
 * the alert, so we skip to avoid double-alerting. Never throws.
 */
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { AppState } from 'react-native';

// Show the alert + play the sound even while the app is foregrounded (so a
// scheduled notification is never silently swallowed by the OS).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Cached permission state — canNotify() reads this without an async call. */
let granted = false;

/**
 * Ask the OS for notification permission (idempotent). On Android also ensures
 * the high-importance "New orders" channel exists. Updates the cached `granted`
 * flag and returns 'granted' | 'denied'. Never throws.
 */
export async function requestNotifyPermission(): Promise<string> {
  try {
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    await Notifications.setNotificationChannelAsync('default', {
      name: 'New orders',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 400, 150, 400],
      lightColor: '#3F51D6',
    });
    granted = status === 'granted';
    return granted ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Whether notification permission has been granted. */
export function canNotify(): boolean {
  return granted;
}

/**
 * Fire a system notification for a new order — but ONLY when permission is
 * granted AND the app is backgrounded. When foregrounded the in-app banner +
 * sound cover the alert, so we skip to avoid double-alerting.
 */
export function notifyNewOrder(title: string, body: string): void {
  if (!granted) return;
  if (AppState.currentState === 'active') return; // foreground — banner + sound cover it
  try {
    void Notifications.scheduleNotificationAsync({
      content: { title, body, data: { tag: 'passwaala-order' }, sound: 'default' },
      trigger: null,
    });
  } catch {
    /* ignore a single failed notification */
  }
}

/** Strong warning haptic so a new order is felt even in a pocket. */
export function vibrate(): void {
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  } catch {
    /* ignore */
  }
}
