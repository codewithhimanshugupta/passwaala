import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { OrderStatus, UserRole } from '@passwaala/shared';
import type { AuthPayload } from '../auth/auth-payload';

/** Room helpers — clients join only their OWN shop/customer/rider room (no cross-tenant leak). */
export const shopRoom = (shopId: string): string => `shop:${shopId}`;
export const customerRoom = (customerId: string): string => `customer:${customerId}`;
export const riderRoom = (userId: string): string => `rider:${userId}`;

/**
 * Socket CORS: mirror the HTTP allowlist (main.ts) — any *.vercel.app,
 * *.passwaala.in or *.nearbaz.in origin, plus localhost dev. A function origin
 * check lets us accept the same set without hard-coding every deploy URL.
 */
function socketCorsOrigin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void): void {
  if (!origin) return cb(null, true);
  try {
    const host = new URL(origin).hostname;
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === 'passwaala.in' ||
      host === 'nearbaz.in' ||
      host.endsWith('.vercel.app') ||
      host.endsWith('.passwaala.in') ||
      host.endsWith('.nearbaz.in')
    ) {
      return cb(null, true);
    }
  } catch {
    /* malformed origin */
  }
  return cb(null, false);
}

/**
 * RealtimeGateway — Socket.IO layer for live order/job events, replacing client
 * polling (plan → Realtime, Dispatch). Sockets authenticate via the JWT from the
 * handshake and join ONLY their own rooms, so events never leak cross-tenant:
 *  - every user joins `customer:<sub>` (their order-tracking channel)
 *  - a SHOPKEEPER with a shop-scoped token joins `shop:<shopId>` (new-order feed)
 *  - a RIDER joins `rider:<sub>` (job offers + system alerts)
 *
 * The order/dispatch services call the emit* helpers to push to exactly the
 * right room. Clients keep only a slow fallback poll for when the socket drops.
 */
@WebSocketGateway({
  cors: { origin: socketCorsOrigin, credentials: true },
  // Keep connections alive through Render's 55s proxy timeout.
  // Ping every 25s so the connection never goes 55s silent.
  pingInterval: 25000,
  pingTimeout: 60000,
  // Use polling transport first — more reliable through HTTP proxies.
  // Upgrades to WebSocket when possible.
  transports: ['polling', 'websocket'],
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly jwt: JwtService) {}

  /**
   * Authenticate the handshake JWT (same secret as the HTTP guard) and join the
   * caller's own rooms. A missing/invalid token disconnects the socket.
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      const raw =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.headers.authorization as string | undefined);
      const token = raw?.startsWith('Bearer ') ? raw.slice(7) : raw;
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = await this.jwt.verifyAsync<AuthPayload>(token);
      // Everyone gets their own user channel (customer order tracking).
      await client.join(customerRoom(payload.sub));
      if (payload.role === UserRole.SHOPKEEPER && payload.shopId) {
        await client.join(shopRoom(payload.shopId));
      }
      if (payload.role === UserRole.RIDER) {
        await client.join(riderRoom(payload.sub));
      }
      client.data.userId = payload.sub;
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`socket disconnected: ${client.id}`);
  }

  /** Emit `order.created` to the shop's room (new-order alert). */
  emitOrderCreated(shopId: string, payload: { orderId: string }): void {
    this.server?.to(shopRoom(shopId)).emit('order.created', payload);
  }

  /** Emit `order.statusChanged` to the CUSTOMER's room (live tracking). */
  emitOrderStatusChanged(
    customerId: string,
    payload: { orderId: string; status: OrderStatus | string },
  ): void {
    this.server?.to(customerRoom(customerId)).emit('order.statusChanged', payload);
  }

  /** Emit `order.shopUpdated` to the SHOP's room (payment claim, nudge, etc.). */
  emitOrderShopUpdate(
    shopId: string,
    payload: { orderId: string; status: OrderStatus | string },
  ): void {
    this.server?.to(shopRoom(shopId)).emit('order.shopUpdated', payload);
  }

  /** Emit `prescription.created` to the shop's room (new Rx to quote). */
  emitPrescriptionCreated(shopId: string, payload: { prescriptionId: string }): void {
    this.server?.to(shopRoom(shopId)).emit('prescription.created', payload);
  }

  /** Emit `prescription.updated` to the CUSTOMER's room (quoted / rejected). */
  emitPrescriptionUpdated(
    customerId: string,
    payload: { prescriptionId: string; status: string; orderId?: string },
  ): void {
    this.server?.to(customerRoom(customerId)).emit('prescription.updated', payload);
  }

  /** Emit `job.offered` to a specific rider (dispatch offer). */
  emitJobOffered(userId: string, payload: { orderId: string }): void {
    this.server?.to(riderRoom(userId)).emit('job.offered', payload);
  }

  /** Emit `system.alert` to a specific rider (penalty / escalation notice). */
  emitSystemAlert(userId: string, payload: { message: string }): void {
    this.server?.to(riderRoom(userId)).emit('system.alert', payload);
  }
}
