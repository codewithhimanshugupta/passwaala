import { PasswaalaApiClient } from '@passwaala/api-client';

/**
 * Shared API client for the customer app, with token persistence so a page
 * refresh (web) or app restart (native) keeps the user logged in until they
 * explicitly log out.
 *
 * On web we use localStorage; on native, AsyncStorage/SecureStore would be
 * wired the same way behind loadToken/saveToken. The client calls onTokenChange
 * whenever the token is set/cleared, so persistence stays in one place.
 */
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'passwaala.customer.token';

function loadToken(): string | undefined {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(TOKEN_KEY) ?? undefined;
    }
  } catch {
    /* storage unavailable (native / SSR) — falls back to in-memory */
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
 * Auth-expired listener registry. The client fires `onUnauthorized` on any 401
 * (after clearing the token). We fan that out to app-level listeners so the
 * root can drop back to the login screen with a friendly notice, instead of
 * rendering a generic "Invalid or expired token" error inside a screen.
 */
const authExpiredListeners = new Set<() => void>();

/** Fan a 401 out to all app-level listeners. */
function fireAuthExpired(): void {
  for (const fn of authExpiredListeners) fn();
}

/** Register a listener fired when the session expires (401). Returns an unsubscribe. */
export function onAuthExpired(fn: () => void): () => void {
  authExpiredListeners.add(fn);
  return () => authExpiredListeners.delete(fn);
}

// Track whether the user had a valid token when a request was made.
// onTokenChange clears localStorage BEFORE onUnauthorized fires, so we
// can't use loadToken() inside onUnauthorized to know if they were logged in.
let hadToken = !!loadToken();

export const api = new PasswaalaApiClient({
  baseUrl,
  token: loadToken(),
  onTokenChange: (token) => {
    saveToken(token);
    if (token) hadToken = true; // login — mark as logged in
    // Do NOT set hadToken=false here; let onUnauthorized own that transition
    // so the check in onUnauthorized still sees the pre-401 state.
  },
  onUnauthorized: () => {
    const wasLoggedIn = hadToken;
    hadToken = false;
    // Only route to login if the user was actually logged in. A 401 on a
    // public-but-auth-optional endpoint (e.g. GET /cart while browsing
    // without an account) should not interrupt the unauthenticated flow.
    if (wasLoggedIn) {
      fireAuthExpired();
    }
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
 * Update the signed-in user's display name via PATCH /account/me. The shared
 * client has no typed method for this yet, so we call the endpoint directly
 * with the same auth header + error shape the client uses.
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
      // Mirror the client's behaviour: clear the session and notify the app.
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
