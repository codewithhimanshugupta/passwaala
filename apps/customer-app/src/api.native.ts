import { NearBazApiClient, friendlyMessage } from '@nearbaz/api-client';
import { notifyError } from './toast';
import * as SecureStore from 'expo-secure-store';

/**
 * NATIVE variant of api.ts (Metro picks `.native.ts` on iOS/Android; the web
 * build keeps api.ts unchanged). Token persistence uses expo-secure-store.
 *
 * SecureStore exposes SYNCHRONOUS getItem/setItem in SDK 51, so loadToken()
 * stays synchronous — the client can be constructed with the restored token on
 * the first render, exactly like the web localStorage path. No bootstrap gate
 * needed. Deletion uses deleteItemAsync (fire-and-forget; logout need not block).
 */
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'nearbaz_customer_token'; // SecureStore keys: [A-Za-z0-9._-]

function loadToken(): string | undefined {
  try {
    return SecureStore.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    /* keychain unavailable — falls back to in-memory */
  }
  return undefined;
}

function saveToken(token?: string): void {
  try {
    if (token) SecureStore.setItem(TOKEN_KEY, token);
    else void SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Auth-expired listener registry. The client fires `onUnauthorized` on any 401
 * (after clearing the token). We fan that out to app-level listeners so the
 * root can drop back to the login screen with a friendly notice.
 */
const authExpiredListeners = new Set<() => void>();

function fireAuthExpired(): void {
  for (const fn of authExpiredListeners) fn();
}

/** Register a listener fired when the session expires (401). Returns an unsubscribe. */
export function onAuthExpired(fn: () => void): () => void {
  authExpiredListeners.add(fn);
  return () => authExpiredListeners.delete(fn);
}

let hadToken = !!loadToken();

export const api = new NearBazApiClient({
  baseUrl,
  token: loadToken(),
  onTokenChange: (token) => {
    saveToken(token);
    if (token) hadToken = true;
  },
  onUnauthorized: () => {
    const wasLoggedIn = hadToken;
    hadToken = false;
    if (wasLoggedIn) {
      fireAuthExpired();
    }
  },
  onError: (err, { method }) => {
    if (method !== 'GET') notifyError(friendlyMessage(err));
  },
});

/** True if we restored a token on startup (used to skip the login screen). */
export function hasSavedToken(): boolean {
  return !!api.getToken();
}

/** Clear the session (logout). */
export function logout(): void {
  api.setToken(undefined);
}

/**
 * Update the signed-in user's display name via PATCH /account/me. Mirrors the
 * web variant (the shared client has no typed method for this yet).
 */
export async function updateName(name: string): Promise<void> {
  const token = api.getToken();
  const res = await fetch(`${baseUrl}/account/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    if (res.status === 401) {
      api.setToken(undefined);
      fireAuthExpired();
      throw new Error('Your session has expired. Please log in again.');
    }
    let message = 'Could not update your name.';
    try {
      const body = (await res.json()) as { message?: unknown };
      if (body && typeof body.message === 'string') message = body.message;
    } catch {
      /* non-JSON error body — keep default */
    }
    throw new Error(message);
  }
}

/** App identity namespace — passed to OTP endpoints so same phone works across apps. */
export const APP_TYPE = 'CUSTOMER' as const;
