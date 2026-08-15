/**
 * Native (iOS/Android) system notifications for order updates in the customer app.
 * The native variant of notify.ts — Metro loads this on iOS/Android while the web
 * bundle keeps the plain notify.ts. Fires local notifications (foreground +
 * background) so the customer knows about order updates without watching the screen.
 * Built on expo-notifications; graceful no-op until permission is granted.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Show foreground notifications (banner + sound), no badge.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Cached grant state — mirrors the web sync `Notification.permission === 'granted'`.
let granted = false;

export async function requestNotifyPermission(): Promise<string> {
  try {
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Order updates',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0B7A4B',
      });
    }
    granted = status === 'granted';
    return granted ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export function canNotify(): boolean {
  return granted;
}

/** Fire a notification — always fires (foreground + background) for order events. */
export function notifyOrderUpdate(title: string, body: string, tag: string): void {
  if (!granted) return;
  try {
    void Notifications.scheduleNotificationAsync({
      content: { title, body, data: { tag }, sound: 'default' },
      trigger: null,
    });
  } catch {
    /* ignore */
  }
}
