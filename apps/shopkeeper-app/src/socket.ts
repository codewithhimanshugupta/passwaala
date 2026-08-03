import { io, type Socket } from 'socket.io-client';
import { api } from './api';

/**
 * Realtime socket for the rider app — replaces polling. Connects to the API with
 * the current JWT (server authenticates the handshake + joins this rider's room).
 * The token can rotate (login/logout), so `reconnectSocket()` tears down and
 * reconnects with the fresh token. Screens/hooks subscribe via `onSocket(event, fn)`.
 *
 * Events consumed by the rider app: 'job.offered', 'system.alert',
 * 'order.statusChanged' (for a claimed delivery), 'order.shopUpdated' (n/a here).
 */
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

let socket: Socket | null = null;

/** (Re)connect the socket with the current token. No-op if no token. */
export function connectSocket(): void {
  const token = api.getToken();
  if (!token) return;
  // Tear down any existing connection first (token may have changed).
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  socket = io(baseUrl, {
    auth: { token },
    // Allow the polling fallback, not websocket-only: some browsers/proxies fail
    // the direct WS upgrade, which previously left the app on the slow poll with
    // no live updates. Polling connects first, then upgrades to WS when possible.
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  });
  socket.on('connect', () => console.log('[socket] connected', socket?.id));
  socket.on('connect_error', (e) => console.warn('[socket] connect_error:', e.message));
  socket.on('disconnect', (reason) => console.warn('[socket] disconnected:', reason));
  // Re-attach any handlers registered before (re)connect.
  for (const [event, handlers] of registry) {
    for (const h of handlers) socket.on(event, h);
  }
}

/** Disconnect (on logout). */
export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/** Reconnect with the latest token (call after login / token change). */
export function reconnectSocket(): void {
  connectSocket();
}

// Handler registry so subscriptions survive reconnects.
const registry = new Map<string, Set<(payload: unknown) => void>>();

/** Subscribe to a socket event. Returns an unsubscribe fn. */
export function onSocket(event: string, handler: (payload: unknown) => void): () => void {
  let set = registry.get(event);
  if (!set) {
    set = new Set();
    registry.set(event, set);
  }
  set.add(handler);
  if (socket) socket.on(event, handler);
  return () => {
    set?.delete(handler);
    if (socket) socket.off(event, handler);
  };
}

/** True when the socket is currently connected (for fallback-poll decisions). */
export function isSocketConnected(): boolean {
  return !!socket?.connected;
}
