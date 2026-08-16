/**
 * NATIVE (iOS/Android) system notifications for new delivery jobs & system
 * alerts. Metro picks this `.native.ts` on native; the web build keeps notify.ts
 * (browser Notification API). Mirrors the web semantics: new-job notifications
 * only fire when the app is backgrounded (the in-app banner + looping sound
 * cover the foreground), while system alerts (escalations / penalties) always
 * fire. Built on expo-notifications + expo-haptics. Never throws.
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
 * the high-importance "New jobs & alerts" channel exists. Updates the cached
 * `granted` flag and returns 'granted' | 'denied' | 'unsupported'. Never throws.
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
      name: 'New jobs & alerts',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 400, 150, 400],
      lightColor: '#F2711C',
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
 * Fire a system notification for a new job — but ONLY when permission is granted
 * AND the app is backgrounded. When foregrounded the in-app banner + looping
 * sound cover the alert, so we skip to avoid double-alerting.
 */
export function notifyNewJob(title: string, body: string): void {
  if (!granted) return;
  if (AppState.currentState === 'active') return; // foreground — banner + sound cover it
  try {
    void Notifications.scheduleNotificationAsync({
      content: { title, body, data: { tag: 'nearbaz-job' }, sound: 'default' },
      trigger: null,
    });
  } catch {
    /* ignore a single failed notification */
  }
}

/**
 * Fire a system notification for a system alert (escalation / penalty). Unlike
 * jobs, this fires even when foregrounded — there's no looping sound for these,
 * so an OS notification is the primary signal.
 */
export function notifyAlert(title: string, body: string): void {
  if (!granted) return;
  try {
    void Notifications.scheduleNotificationAsync({
      content: { title, body, data: { tag: 'nearbaz-alert' }, sound: 'default' },
      trigger: null,
    });
  } catch {
    /* ignore a single failed notification */
  }
}

/** Strong warning haptic so a new job is felt even in a pocket. */
export function vibrate(): void {
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  } catch {
    /* ignore */
  }
}
