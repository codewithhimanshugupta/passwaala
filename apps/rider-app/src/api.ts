import { PasswaalaApiClient } from '@passwaala/api-client';

/**
 * Shared API client for the rider app, with token persistence so a refresh
 * (web) or restart (native) keeps the delivery partner logged in until they log
 * out.
 */
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'passwaala.rider.token';

function loadToken(): string | undefined {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(TOKEN_KEY) ?? undefined;
    }
  } catch {
    /* storage unavailable */
  }
  return undefined;
}

function saveToken(token?: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Auth-expiry listeners. The client fires `onUnauthorized` on any 401 (after
 * clearing the token); we fan that out to registered listeners so the root App
 * can route back to login and show a "session expired" note.
 */
type AuthExpiredListener = () => void;
const authExpiredListeners = new Set<AuthExpiredListener>();

/** Register a listener invoked when the session expires (a 401 was seen). */
export function onAuthExpired(fn: AuthExpiredListener): () => void {
  authExpiredListeners.add(fn);
  return () => authExpiredListeners.delete(fn);
}

export const api = new PasswaalaApiClient({
  baseUrl,
  token: loadToken(),
  onTokenChange: saveToken,
  onUnauthorized: () => {
    for (const fn of authExpiredListeners) fn();
  },
});

export function hasSavedToken(): boolean {
  return !!api.getToken();
}

export function logout(): void {
  api.setToken(undefined);
}

/** App identity namespace — passed to OTP endpoints so same phone works across apps. */
export const APP_TYPE = 'RIDER' as const;
