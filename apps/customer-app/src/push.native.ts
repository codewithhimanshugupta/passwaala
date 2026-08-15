/**
 * Native (iOS/Android) Expo push-token registration for the customer app.
 * The native variant of push.ts — Metro loads this on iOS/Android while the web
 * bundle keeps the no-op push.ts (the PWA handles its own VAPID push elsewhere).
 * Registers the device's Expo push token with the backend so the server can send
 * remote order-update pushes; unregisters on logout. Never throws.
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { api, APP_TYPE } from './api';

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

let lastToken: string | null = null;

export async function registerPushToken(): Promise<void> {
  try {
    // Push tokens require a physical device.
    if (!Device.isDevice) return;

    // Ensure notification permission before requesting a token.
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return;

    // EAS assigns the projectId at build time — skip gracefully until then.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    lastToken = token;

    const authToken = api.getToken();
    await fetch(`${baseUrl}/push/expo/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        token,
        platform: Platform.OS,
        appType: APP_TYPE,
        deviceId: Constants.sessionId ?? undefined,
      }),
    });
  } catch {
    /* never throw */
  }
}

export async function unregisterPushToken(): Promise<void> {
  try {
    if (lastToken) {
      const authToken = api.getToken();
      await fetch(`${baseUrl}/push/expo/unregister`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ token: lastToken }),
      });
      lastToken = null;
    }
  } catch {
    /* never throw */
  }
}
