/** Web no-op: the PWA handles its own VAPID push elsewhere. Native variant (push.native.ts) registers Expo push tokens. */
export async function registerPushToken(): Promise<void> {}
export async function unregisterPushToken(): Promise<void> {}
