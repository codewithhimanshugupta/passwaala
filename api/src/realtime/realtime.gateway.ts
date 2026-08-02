import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { OrderStatus } from '@passwaala/shared';

/** Room helpers — clients join only their OWN shop/customer room (no cross-tenant leak). */
export const shopRoom = (shopId: string): string => `shop:${shopId}`;
export const customerRoom = (customerId: string): string => `customer:${customerId}`;

/**
 * RealtimeGateway — Socket.IO layer for live order events (plan → Realtime,
 * Order Reliability's "guaranteed shopkeeper delivery", Dispatch seam).
 *
 * PHASE 0 SCOPE: the gateway wires up and exposes the emit helpers the order
 * flow will call (order.created → shop room, order.statusChanged → customer
 * room). It does NOT yet authenticate sockets or fan out real events — Phase 1
 * adds JWT socket auth + room-join on connect, and the order service emits on
 * state changes.
 *
 * HARD RULES when implemented (plan → Security: WebSocket auth):
 *  - Sockets authenticate via JWT and join ONLY their own shop/customer room,
 *    so realtime events can't leak cross-tenant.
 *  - The same gateway later carries rider location + dispatch.offer events with
 *    no architectural change (generic seam).
 */
@WebSocketGateway({ cors: { origin: false } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  /** TODO (Phase 1): verify the JWT from the handshake and join the caller's
   * own shop/customer room before accepting events. */
  handleConnection(client: Socket): void {
    this.logger.debug(`socket connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`socket disconnected: ${client.id}`);
  }

  /** Emit `order.created` to the shop's room (new-order alert). */
  emitOrderCreated(shopId: string, payload: { orderId: string }): void {
    this.server?.to(shopRoom(shopId)).emit('order.created', payload);
  }

  /** Emit `order.statusChanged` to the customer's room (live tracking). */
  emitOrderStatusChanged(
    customerId: string,
    payload: { orderId: string; status: OrderStatus },
  ): void {
    this.server?.to(customerRoom(customerId)).emit('order.statusChanged', payload);
  }
}
