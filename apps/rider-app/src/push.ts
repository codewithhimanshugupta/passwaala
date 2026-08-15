/**
 * Web no-op push-token registration. Native (iOS/Android) uses push.native.ts to
 * register an Expo push token with the backend; on web there is no Expo push, so
 * these are graceful no-ops.
 */
export async function registerPushToken(): Promise<void> {}
export async function unregisterPushToken(): Promise<void> {}
