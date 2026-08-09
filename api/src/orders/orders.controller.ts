import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { OrderStatus, UserRole } from '@passwaala/shared';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, ShopId } from '../common/current-user.decorator';
import { PaginationQuery } from '../common/pagination';
import { AuthPayload } from '../auth/auth-payload';
import { OrdersService } from './orders.service';
import { AdvanceOrderDto } from './dto/advance-order.dto';
import { PlaceOrderDto } from './dto/place-order.dto';
import { MarkUnavailableDto } from './dto/mark-unavailable.dto';
import { FeedQuery } from './dto/feed-query.dto';
import { AddOrderItemsDto } from './dto/add-order-items.dto';

/**
 * OrdersController — customer places/tracks orders; shopkeeper reads their
 * incoming feed and advances status.
 *
 * Shopkeeper routes are scoped to their OWN shop via @ShopId() (JWT), never
 * client input. STATIC routes (history, feed) are declared BEFORE the
 * parameterized :id route so they aren't shadowed by it.
 */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Customer places an order from their cart (durable + idempotent). Open to
   * any authenticated user (customer surface). */
  @Post()
  place(@CurrentUser() user: AuthPayload, @Body() dto: PlaceOrderDto) {
    return this.orders.place(user.sub, dto);
  }

  /** Their order history (newest first), keyset paginated (?limit=&cursor=). */
  @Get('history')
  history(@CurrentUser() user: AuthPayload, @Query() page: PaginationQuery) {
    return this.orders.historyForCustomer(user.sub, page);
  }

  /**
   * Shopkeeper: incoming order feed for their OWN shop, one tab at a time.
   * `?status=` is a comma-separated status set (the UI tab); paged via
   * ?limit=&cursor=. Omitting status returns all statuses.
   */
  @Roles(UserRole.SHOPKEEPER)
  @Get('feed')
  feed(@ShopId() shopId: string | undefined, @Query() query: FeedQuery) {
    const statuses = query.status
      ? (query.status.split(',').filter(Boolean) as OrderStatus[])
      : undefined;
    return this.orders.feedForShop(shopId, statuses, {
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  /** Shopkeeper: per-status order counts for their OWN shop (feed tab badges). */
  @Roles(UserRole.SHOPKEEPER)
  @Get('feed/counts')
  feedCounts(@ShopId() shopId: string | undefined) {
    return this.orders.feedCountsForShop(shopId);
  }

  /** Shopkeeper: unified feed across ALL owned shops (multi-shop owner view). */
  @Roles(UserRole.SHOPKEEPER)
  @Get('feed/all')
  feedAll(@CurrentUser() user: AuthPayload, @Query() query: FeedQuery) {
    const statuses = query.status
      ? (query.status.split(',').filter(Boolean) as OrderStatus[])
      : undefined;
    return this.orders.feedForAllShops(user.sub, statuses, {
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  /** Shopkeeper: per-status counts across ALL owned shops. */
  @Roles(UserRole.SHOPKEEPER)
  @Get('feed/all/counts')
  feedAllCounts(@CurrentUser() user: AuthPayload) {
    return this.orders.feedCountsForAllShops(user.sub);
  }

  /** Shopkeeper: home analytics (today / 7-day / this-month + active orders). */
  @Roles(UserRole.SHOPKEEPER)
  @Get('stats')
  stats(@ShopId() shopId: string | undefined) {
    return this.orders.statsForShop(shopId);
  }

  /** Full detail / tracking of one of the caller's own orders. */
  @Get(':id')
  findOne(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.orders.findOneForCustomer(user.sub, id);
  }

  /** Customer: add more items to a live order (PLACED/ACCEPTED/AWAITING_PAYMENT/PREPARING). */
  @Post(':id/add-items')
  addItems(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Body() dto: AddOrderItemsDto,
  ) {
    return this.orders.addItemsToOrder(user.sub, id, dto.items);
  }

  /** Customer claims they've paid (a claim — the shop verifies). */
  @Post(':id/confirm-payment')
  confirmPayment(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.orders.confirmPayment(user.sub, id);
  }

  /** Shopkeeper: verify a payment claim (money received) → PREPARING. */
  @Roles(UserRole.SHOPKEEPER)
  @Post(':id/payment-received')
  paymentReceived(@ShopId() shopId: string | undefined, @Param('id') id: string) {
    return this.orders.verifyPayment(shopId, id);
  }

  /** Shopkeeper: reject a payment claim (not received) → re-prompt customer. */
  @Roles(UserRole.SHOPKEEPER)
  @Post(':id/payment-not-received')
  paymentNotReceived(@ShopId() shopId: string | undefined, @Param('id') id: string) {
    return this.orders.rejectPaymentClaim(shopId, id);
  }

  /** Shopkeeper: confirm a rider's COD-by-UPI claim (money received at the door). */
  @Roles(UserRole.SHOPKEEPER)
  @Post(':id/cod-upi-received')
  codUpiReceived(@ShopId() shopId: string | undefined, @Param('id') id: string) {
    return this.orders.confirmCodUpiReceived(shopId, id);
  }

  /** Shopkeeper: the rider's COD-by-UPI claim was NOT received → clear it. */
  @Roles(UserRole.SHOPKEEPER)
  @Post(':id/cod-upi-not-received')
  codUpiNotReceived(@ShopId() shopId: string | undefined, @Param('id') id: string) {
    return this.orders.rejectCodUpi(shopId, id);
  }

  /** One-tap reorder — rebuild the cart from a past order. */
  @Post(':id/reorder')
  reorder(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.orders.reorder(user.sub, id);
  }

  /** Shopkeeper: advance an order's status (accept/reject/prepare/...). */
  @Roles(UserRole.SHOPKEEPER)
  @Patch(':id/status')
  advanceStatus(
    @ShopId() shopId: string | undefined,
    @Param('id') id: string,
    @Body() dto: AdvanceOrderDto,
  ) {
    return this.orders.advanceStatus(shopId, id, dto);
  }

  /** Shopkeeper: mark order items unavailable (item substitution). */
  @Roles(UserRole.SHOPKEEPER)
  @Patch(':id/items/unavailable')
  markUnavailable(
    @ShopId() shopId: string | undefined,
    @Param('id') id: string,
    @Body() dto: MarkUnavailableDto,
  ) {
    return this.orders.markUnavailable(shopId, id, dto.orderItemIds);
  }

  /** Shopkeeper: move a paid-but-unfulfillable order to REFUND_PENDING. */
  @Roles(UserRole.SHOPKEEPER)
  @Post(':id/refund-pending')
  refundPending(@ShopId() shopId: string | undefined, @Param('id') id: string) {
    return this.orders.markRefundPending(shopId, id);
  }

  /** Customer: send a one-time nudge message to the shop on an active order. */
  @Roles(UserRole.CUSTOMER)
  @Post(':id/nudge')
  nudge(@CurrentUser() user: AuthPayload, @Param('id') id: string, @Body('message') message: string) {
    return this.orders.sendNudge(user.sub, id, message);
  }

  /** Customer: accept shop's item changes (removed items) — unblocks the order. */
  @Roles(UserRole.CUSTOMER)
  @Post(':id/accept-changes')
  acceptChanges(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.orders.acceptOrderChanges(user.sub, id);
  }

  /** Customer: confirm an off-platform refund was received → REFUNDED. */
  @Roles(UserRole.CUSTOMER)
  @Post(':id/refund-received')
  confirmRefundReceived(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.orders.confirmRefundReceived(user.sub, id);
  }
}
