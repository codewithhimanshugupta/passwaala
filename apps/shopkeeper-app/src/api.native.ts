import { NearBazApiClient } from '@nearbaz/api-client';
import * as SecureStore from 'expo-secure-store';

/**
 * NATIVE variant of api.ts (Metro picks `.native.ts` on iOS/Android; the web
 * build keeps api.ts). Token persistence uses expo-secure-store, whose
 * getItem/setItem are synchronous in SDK 51 — so loadToken() stays sync and the
 * client is constructed with the restored token on first render (no gate).
 */
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'nearbaz_shopkeeper_token'; // SecureStore keys: [A-Za-z0-9._-]

function loadToken(): string | undefined {
  try {
    return SecureStore.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    /* keychain unavailable */
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

type AuthExpiredListener = () => void;
const authExpiredListeners = new Set<AuthExpiredListener>();

/** Register a listener invoked when the session expires (a 401 was seen). */
export function onAuthExpired(fn: AuthExpiredListener): () => void {
  authExpiredListeners.add(fn);
  return () => authExpiredListeners.delete(fn);
}

export const api = new NearBazApiClient({
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

function fireAuthExpired(): void {
  api.setToken(undefined);
  for (const fn of authExpiredListeners) fn();
}

/**
 * Update the signed-in partner's display name via PATCH /account/me. Mirrors the
 * web variant (the shared client has no typed method for this).
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
