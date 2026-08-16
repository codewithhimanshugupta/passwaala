import { PasswaalaApiClient, friendlyMessage } from '@passwaala/api-client';
import { notifyError } from './toast';
import type { POSCreateSale, POSSaleResult } from '@passwaala/shared';
import { enqueueOutbox, flushOutbox, PosOfflineError, type FlushResult } from './posOutbox';

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
  onError: (err, { method }) => {
    // User-initiated actions (writes) surface a short friendly popup. Background
    // GET polls have their own screen-level load/empty states.
    if (method !== 'GET') notifyError(friendlyMessage(err));
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

// ─────────────────────────────────────────────────────────────────────────────
// POS (counter-sale) network layer with an offline outbox.
//
// A sale is rung up + its receipt printed locally *immediately*; the network
// write is decoupled. `postPosSale` distinguishes a genuine network failure
// (→ PosOfflineError → queue + retry later) from a server rejection (→ surface
// the error). Exactly-once is guaranteed server-side by the sale's
// idempotencyKey, so replaying a queued body that already committed is safe.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send one counter sale to POST /orders/pos via a direct fetch (the shared
 * client has no offline-aware method). A thrown fetch (device offline / DNS /
 * connection refused) becomes a `PosOfflineError`; a 401 fires auth-expiry; any
 * other non-2xx becomes a plain Error carrying the server message.
 */
export async function postPosSale(body: POSCreateSale): Promise<POSSaleResult> {
  const token = api.getToken();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/orders/pos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Network unreachable — signal "queue it / stop flushing".
    throw new PosOfflineError();
  }
  if (!res.ok) {
    if (res.status === 401) {
      fireAuthExpired();
      throw new Error('Your session has expired. Please log in again.');
    }
    let message = 'Could not record the sale.';
    try {
      const parsed = (await res.json()) as { message?: unknown };
      if (parsed && typeof parsed.message === 'string') message = parsed.message;
    } catch {
      /* non-JSON error body — keep default */
    }
    throw new Error(message);
  }
  return (await res.json()) as POSSaleResult;
}

/** Outcome of a POS sale attempt: committed online, or queued for later sync. */
export interface PosSaleOutcome {
  /** True when the server confirmed the sale; false when queued offline. */
  synced: boolean;
  /** The server result (present only when `synced`). */
  result?: POSSaleResult;
}

/**
 * Place a counter sale with offline fallback: try the network write; if the
 * device is offline, durably queue the body (tagged with `shopId`) for automatic
 * retry and report `synced: false`. Any non-network error (e.g. validation) is
 * rethrown so the screen can surface it — the sale is NOT queued in that case.
 */
export async function posSaleWithOutbox(shopId: string, body: POSCreateSale): Promise<PosSaleOutcome> {
  try {
    const result = await postPosSale(body);
    return { synced: true, result };
  } catch (err) {
    if (err instanceof PosOfflineError) {
      await enqueueOutbox(shopId, body);
      return { synced: false };
    }
    throw err;
  }
}

/**
 * Flush the offline POS outbox for one shop (called on socket reconnect / screen
 * focus). Scoped by `shopId` so a queued sale only ever replays while that
 * shop's token is active — the server derives shopId from the JWT, so replaying
 * under the wrong shop would misfile the sale.
 */
export function flushPosOutbox(shopId: string): Promise<FlushResult> {
  return flushOutbox(postPosSale, shopId);
}
