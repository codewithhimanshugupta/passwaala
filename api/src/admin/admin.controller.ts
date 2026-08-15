import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@passwaala/shared';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { PaginationQuery } from '../common/pagination';
import { AuthPayload } from '../auth/auth-payload';
import { AdminService } from './admin.service';
import { ReviewShopDto } from './dto/review-shop.dto';
import { DashboardPeriod, DashboardQuery } from './dashboard-query.dto';
import { PaymentClaimsService } from '../payment-claims/payment-claims.service';
import { RidersService } from '../riders/riders.service';
import { LedgerService } from '../ledger/ledger.service';

/**
 * AdminController — shop approval + KYC review surface. ADMIN and OWNER only
 * (deny-by-default RBAC). This is the only role with cross-shop visibility.
 */
@Roles(UserRole.ADMIN, UserRole.OWNER)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly claims: PaymentClaimsService,
    private readonly riders: RidersService,
    private readonly ledger: LedgerService,
  ) {}

  /** Shops awaiting review. */
  @Get('shops/pending')
  listPending() {
    return this.admin.listPendingShops();
  }

  /** All shops (optionally ?city=) with config — for the admin console list. */
  @Get('shops')
  listAll(@Query('city') city?: string) {
    return this.admin.listAllShops(city);
  }

  /** Full shop detail — config, KYC, products with stock, recent orders. */
  @Get('shops/:id/detail')
  shopDetail(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.admin.shopDetail(user.sub, id);
  }

  /** Owner/platform dashboard: cross-shop aggregate stats. The Order Status
   *  widget is scoped to the caller's city + selected time period. */
  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthPayload, @Query() q: DashboardQuery) {
    return this.admin.dashboard(user.sub, String(user.role), q.period ?? DashboardPeriod.Today);
  }

  /** Disputed orders (CANCELLED / REFUND_PENDING) with reasons, keyset paginated. */
  @Get('orders/disputes')
  disputes(@Query() page: PaginationQuery) {
    return this.admin.disputedOrders(page);
  }

  /** View a shop's KYC + docs (audit-logged crown-jewels access). */
  @Get('shops/:id/kyc')
  viewKyc(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.admin.viewKyc(user.sub, id);
  }

  /** Approve a shop (goes live; starts commission holiday + onboarding fee). */
  @Post('shops/:id/approve')
  approve(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.admin.approve(user.sub, id);
  }

  /** Reject a shop with a reason. */
  @Post('shops/:id/reject')
  reject(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Body() dto: ReviewShopDto,
  ) {
    return this.admin.reject(user.sub, id, dto);
  }

  /** Suspend a shop (instantly hides it). */
  @Post('shops/:id/suspend')
  suspend(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.admin.suspend(user.sub, id);
  }

  /** Reactivate a suspended shop → APPROVED (starts closed; shopkeeper can re-open). */
  @Post('shops/:id/reactivate')
  reactivate(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.admin.reactivate(user.sub, id);
  }

  /** Set a shop's commission rate (decimal fraction, e.g. 0.02 = 2%). */
  @Post('shops/:id/commission')
  setCommission(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Body('rate') rate: number,
  ) {
    return this.admin.setCommissionRate(user.sub, id, rate);
  }

  /** Admin: enable or disable COD for a shop. */
  @Post('shops/:id/cod-toggle')
  setCodEnabled(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Body('enabled') enabled: boolean,
  ) {
    return this.admin.setCodEnabled(user.sub, id, enabled);
  }

  /** All platform riders with earnings + COD dues — for the admin riders console. */
  @Get('riders')
  listRiders(@Query('city') city?: string) {
    return this.admin.listRiders(city);
  }

  /** Full detail for one rider — profile + KYC (identity + documents) + recent orders. */
  @Get('riders/:userId')
  riderDetail(@Param('userId') userId: string) {
    return this.admin.riderDetail(userId);
  }

  /** All platform customers with coin balance + order stats — for the admin customers console. */
  @Get('customers')
  listCustomers(@Query('q') q?: string) {
    return this.admin.listCustomers({ q });
  }

  /** All orders across the platform — live + completed, with OTPs and payment state. */
  @Get('orders')
  listAllOrders(@Query() page: PaginationQuery) {
    return this.admin.listAllOrders(page, page.status, (page as Record<string, string>).shopId);
  }

  /** Record that a rider has deposited their collected COD cash → clears dues. */
  @Post('riders/:userId/record-payment')
  recordRiderPayment(@CurrentUser() user: AuthPayload, @Param('userId') userId: string) {
    return this.admin.recordRiderPayment(user.sub, userId);
  }

  /** Pay a rider their accrued delivery earnings (decrements the earnings balance). */
  @Post('riders/:userId/pay-earnings')
  payRiderEarnings(
    @CurrentUser() user: AuthPayload,
    @Param('userId') userId: string,
    @Body('amountPaise') amountPaise: number,
  ) {
    return this.riders.payEarnings(userId, amountPaise, user.sub);
  }

  /** Pay a shop its negative balance (money NearBaz owes it, e.g. COD remittance). */
  @Post('shops/:shopId/pay-payable')
  payShopPayable(@Param('shopId') shopId: string, @Body('amountPaise') amountPaise: number) {
    return this.ledger.payShopPayable(shopId, amountPaise);
  }

  /** All pending payment claims (shopkeeper dues + rider COD deposits). */
  @Get('payment-claims')
  listPaymentClaims() {
    return this.claims.listPending();
  }

  /** Approve a payment claim — decrements the payer's balance by the exact claimed amount. */
  @Post('payment-claims/:id/approve')
  approvePaymentClaim(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.claims.approveClaim(id, user.sub);
  }

  /** Admin taskboard: pending manual tasks + recent automation log. */
  @Get('taskboard')
  getTaskboard() {
    return this.admin.getTaskboard();
  }

  /** Revert an automation action (undo the system's side-effect). */
  @Patch('automation/:logId/revert')
  revertAutomation(
    @CurrentUser() user: AuthPayload,
    @Param('logId') logId: string,
    @Body('note') note?: string,
  ) {
    return this.admin.revertAutomation(logId, user.sub, note);
  }

  /** Admin: force-cancel any non-terminal order (with reason). */
  @Post('orders/:orderId/cancel')
  cancelOrder(
    @CurrentUser() user: AuthPayload,
    @Param('orderId') orderId: string,
    @Body('reason') reason: string,
  ) {
    return this.admin.cancelOrder(user.sub, orderId, reason);
  }

  /** Admin: assign additional riders to a bulk order. */
  @Post('orders/:orderId/assign-riders')
  assignAdditionalRiders(
    @CurrentUser() user: AuthPayload,
    @Param('orderId') orderId: string,
    @Body('riderUserIds') riderUserIds: string[],
  ) {
    return this.admin.assignAdditionalRiders(user.sub, orderId, riderUserIds);
  }

  /** Admin: update delivery fee on a live order. For prepaid orders the delta
   *  above the original fee is stored as extraDeliveryDuePaise (due at delivery). */
  @Post('orders/:orderId/delivery-fee')
  updateOrderDeliveryFee(
    @CurrentUser() user: AuthPayload,
    @Param('orderId') orderId: string,
    @Body('newFeePaise') newFeePaise: number,
  ) {
    return this.admin.updateOrderDeliveryFee(user.sub, orderId, newFeePaise);
  }

  /** Admin: bulk orders list (keyset paginated). */
  @Get('bulk-orders')
  listBulkOrders(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.admin.listBulkOrders(limit ? parseInt(limit) : 20, cursor);
  }

  /** Admin: full detail for one bulk order. */
  @Get('bulk-orders/:id')
  getBulkOrder(@Param('id') id: string) {
    return this.admin.getBulkOrder(id);
  }

  /** Admin: mark an order as partially delivered (some items not received). Opens a dispute for partial refund. */
  @Post('orders/:orderId/partial-delivery')
  markPartialDelivery(
    @CurrentUser() user: AuthPayload,
    @Param('orderId') orderId: string,
    @Body('fulfilledItemIds') fulfilledItemIds: string[],
  ) {
    return this.admin.markPartialDelivery(user.sub, orderId, fulfilledItemIds);
  }
}
