import { PasswaalaApiClient } from '@passwaala/api-client';

/**
 * Shared API client for the shopkeeper app, with token persistence so a refresh
 * (web) or restart (native) keeps the shopkeeper logged in until they log out.
 */
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'passwaala.shopkeeper.token';

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

export async function logout(): Promise<void> {
  // Fire the server-side close before dropping the token. We swallow errors so
  // a network failure (or already-expired token) never blocks the client logout.
  try { await api.logoutUser(); } catch { /* ignore */ }
  api.setToken(undefined);
}

/** The partner's own account (GET /account/me). */
export interface MyAccount {
  id: string;
  name: string | null;
  phone: string;
  coinBalance: number;
}

/** Notify listeners + clear the token on a 401 from a direct fetch. */
function fireAuthExpired(): void {
  api.setToken(undefined);
  for (const fn of authExpiredListeners) fn();
}

/**
 * Update the signed-in partner's display name via PATCH /account/me. The shared
 * client has no typed method for this, so we call the endpoint directly with the
 * same auth header + error handling the client uses.
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
export const APP_TYPE = 'SHOPKEEPER' as const;
