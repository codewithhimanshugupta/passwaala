import { ApiError, AuthExpiredError, PasswaalaApiClient, friendlyMessage } from '@passwaala/api-client';
import { notifyError } from './toast';

/**
 * Shared API client for the NearBaz admin app, with token persistence so a
 * refresh (web) or restart (native) keeps the admin logged in until they log
 * out. Mirrors the customer/shopkeeper apps but uses an admin-scoped storage key.
 */
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'passwala.admin.token';

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
 * Auth-expired listener registry. The API client fires `onUnauthorized` on any
 * 401 (after clearing the token); we fan that out to registered listeners so
 * App.tsx can drop the user back to the login screen instead of surfacing a
 * generic error. Returns an unsubscribe fn.
 */
type AuthExpiredListener = () => void;
const authExpiredListeners = new Set<AuthExpiredListener>();

export function onAuthExpired(fn: AuthExpiredListener): () => void {
  authExpiredListeners.add(fn);
  return () => {
    authExpiredListeners.delete(fn);
  };
}

function emitAuthExpired(): void {
  for (const fn of authExpiredListeners) {
    try {
      fn();
    } catch {
      /* a broken listener must not stop the others */
    }
  }
}

export const api = new PasswaalaApiClient({
  baseUrl,
  token: loadToken(),
  onTokenChange: saveToken,
  onUnauthorized: emitAuthExpired,
  onError: (err, { method }) => {
    if (method !== 'GET') notifyError(friendlyMessage(err));
  },
});

export function hasSavedToken(): boolean {
  return !!api.getToken();
}

export function logout(): void {
  api.setToken(undefined);
}

/** The logged-in operator's role, as returned by GET /account/me. */
export type MeRole = 'OWNER' | 'ADMIN' | 'SHOPKEEPER' | 'CUSTOMER' | string;

export interface Me {
  id: string;
  phone: string;
  name: string | null;
  role: MeRole;
  coinBalance: number;
}

/** Read the signed-in account (id, phone, name, role, coinBalance). */
export function me(): Promise<Me> {
  return api.me() as Promise<Me>;
}

/**
 * Admin settlement: clear a shop's outstanding dues and reactivate it after
 * NearBaz has collected payment offline (UPI/bank). Backend route is
 * POST /ledger/record-payment/:shopId (admin/owner only). The shared client
 * doesn't expose this yet, so we call it directly here — mirroring the client's
 * auth + 401 handling so an expired session still routes to login.
 */
export async function recordPayment(shopId: string): Promise<unknown> {
  const token = api.getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(
    `${baseUrl}/ledger/record-payment/${encodeURIComponent(shopId)}`,
    { method: 'POST', headers, body: JSON.stringify({}) },
  );
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    if (res.status === 401) {
      // Match the client: clear the token, notify listeners, throw typed error.
      api.setToken(undefined);
      emitAuthExpired();
      throw new AuthExpiredError();
    }
    const message =
      parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : res.statusText || 'Request failed';
    throw new ApiError(res.status, message, parsed);
  }
  return parsed;
}

export const APP_TYPE = 'ADMIN' as const;
