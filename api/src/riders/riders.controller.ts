import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@passwaala/shared';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { PaginationQuery } from '../common/pagination';
import { AuthPayload } from '../auth/auth-payload';
import { RidersService } from './riders.service';
import { RegisterRiderDto, RiderLocationDto, SetRiderOnlineDto } from './dto/rider.dto';
import { PaymentClaimsService } from '../payment-claims/payment-claims.service';
import { ClaimPaymentDto } from '../payment-claims/claim-payment.dto';

/**
 * RidersController — the platform rider surface. Registration is open to any
 * authenticated user (they become a RIDER server-side); the rest is RIDER-only.
 */
@Controller('riders')
export class RidersController {
  constructor(
    private readonly riders: RidersService,
    private readonly claims: PaymentClaimsService,
  ) {}

  /** Become a rider → returns a fresh RIDER-scoped token. */
  @Post('register')
  register(@CurrentUser() user: AuthPayload, @Body() dto: RegisterRiderDto) {
    return this.riders.register(user.sub, dto);
  }

  /** The caller's rider profile. */
  @Roles(UserRole.RIDER)
  @Get('me')
  me(@CurrentUser() user: AuthPayload) {
    return this.riders.me(user.sub);
  }

  /** Recent system notifications for this rider (from automation log). */
  @Roles(UserRole.RIDER)
  @Get('me/notifications')
  async notifications(@CurrentUser() user: AuthPayload) {
    return this.riders.recentNotifications(user.sub);
  }

  /** Toggle online/offline (+ optional live location). */
  @Roles(UserRole.RIDER)
  @Patch('me/online')
  setOnline(@CurrentUser() user: AuthPayload, @Body() dto: SetRiderOnlineDto) {
    return this.riders.setOnline(user.sub, dto);
  }

  /** Report live GPS position (used mid-delivery for the customer tracking map). */
  @Roles(UserRole.RIDER)
  @Patch('me/location')
  updateLocation(@CurrentUser() user: AuthPayload, @Body() dto: RiderLocationDto) {
    return this.riders.updateLocation(user.sub, dto.latitude, dto.longitude);
  }

  /** Available delivery jobs (READY, unclaimed, platform-rider). Online only. */
  @Roles(UserRole.RIDER)
  @Get('jobs')
  jobs(@CurrentUser() user: AuthPayload) {
    return this.riders.availableJobs(user.sub);
  }

  /** The caller's ACTIVE deliveries (claimed, in-hand). Small bounded set. */
  @Roles(UserRole.RIDER)
  @Get('deliveries')
  deliveries(@CurrentUser() user: AuthPayload) {
    return this.riders.myDeliveries(user.sub);
  }

  /** The caller's completed-delivery history (DELIVERED), keyset paginated. */
  @Roles(UserRole.RIDER)
  @Get('deliveries/history')
  deliveryHistory(@CurrentUser() user: AuthPayload, @Query() page: PaginationQuery) {
    return this.riders.deliveryHistory(user.sub, page);
  }

  /** Claim an available job (first-come). */
  @Roles(UserRole.RIDER)
  @Post('jobs/:orderId/accept')
  accept(@CurrentUser() user: AuthPayload, @Param('orderId') orderId: string) {
    return this.riders.accept(user.sub, orderId);
  }

  /** Decline the job currently offered to this rider → re-offer to the next nearest. */
  @Roles(UserRole.RIDER)
  @Post('jobs/:orderId/decline')
  decline(@CurrentUser() user: AuthPayload, @Param('orderId') orderId: string) {
    return this.riders.decline(user.sub, orderId);
  }

  /** Confirm pickup at the shop (requires the shop's rider pickup OTP). */
  @Roles(UserRole.RIDER)
  @Post('deliveries/:orderId/pickup')
  confirmPickup(
    @CurrentUser() user: AuthPayload,
    @Param('orderId') orderId: string,
    @Body('otp') otp: string,
  ) {
    return this.riders.confirmPickup(user.sub, orderId, otp);
  }

  /** Complete a delivery (requires the customer's handoff OTP). */
  @Roles(UserRole.RIDER)
  @Post('deliveries/:orderId/complete')
  complete(
    @CurrentUser() user: AuthPayload,
    @Param('orderId') orderId: string,
    @Body('otp') otp: string,
    @Body('codPaidViaUpi') codPaidViaUpi?: boolean,
  ) {
    return this.riders.completeDelivery(user.sub, orderId, otp, codPaidViaUpi === true);
  }

  /** Rider claims the customer paid a COD order by UPI/QR (shop then confirms). */
  @Roles(UserRole.RIDER)
  @Post('deliveries/:orderId/claim-upi')
  claimUpi(@CurrentUser() user: AuthPayload, @Param('orderId') orderId: string) {
    return this.riders.claimUpiPaid(user.sub, orderId);
  }

  /** Rider files a dues deposit claim after paying via UPI — admin approves to clear dues. */
  @Roles(UserRole.RIDER)
  @Post('me/claim-dues-payment')
  claimDuesPayment(@CurrentUser() user: AuthPayload, @Body() dto: ClaimPaymentDto) {
    return this.claims.claimRiderPayment(user.sub, dto.amountPaise);
  }

  // ── Bulk-order routes ──────────────────────────────────────────────────────

  /** Accept a bulk-order job (proximity offer or open board). */
  @Roles(UserRole.RIDER)
  @Post('bulk-jobs/:bulkOrderId/accept')
  acceptBulk(@CurrentUser() user: AuthPayload, @Param('bulkOrderId') bulkOrderId: string) {
    return this.riders.acceptBulk(user.sub, bulkOrderId);
  }

  /** Decline the bulk-order job currently offered to this rider. */
  @Roles(UserRole.RIDER)
  @Post('bulk-jobs/:bulkOrderId/decline')
  declineBulk(@CurrentUser() user: AuthPayload, @Param('bulkOrderId') bulkOrderId: string) {
    return this.riders.declineBulk(user.sub, bulkOrderId);
  }

  /** Confirm pickup at one shop in the bulk run (requires that shop's riderPickupOtp). */
  @Roles(UserRole.RIDER)
  @Post('bulk-deliveries/:subOrderId/pickup')
  confirmBulkPickup(
    @CurrentUser() user: AuthPayload,
    @Param('subOrderId') subOrderId: string,
    @Body('otp') otp: string,
  ) {
    return this.riders.confirmBulkPickup(user.sub, subOrderId, otp);
  }

  /** Complete a bulk delivery (requires the customer's single handoff OTP). */
  @Roles(UserRole.RIDER)
  @Post('bulk-deliveries/:bulkOrderId/complete')
  completeBulkDelivery(
    @CurrentUser() user: AuthPayload,
    @Param('bulkOrderId') bulkOrderId: string,
    @Body('otp') otp: string,
    @Body('codPaidViaUpi') codPaidViaUpi?: boolean,
  ) {
    return this.riders.completeBulkDelivery(user.sub, bulkOrderId, otp, codPaidViaUpi === true);
  }

  /** Rider claims the customer paid a COD bulk sub-order by UPI/QR (shop then confirms). */
  @Roles(UserRole.RIDER)
  @Post('bulk-deliveries/:subOrderId/claim-upi')
  claimBulkSubUpi(@CurrentUser() user: AuthPayload, @Param('subOrderId') subOrderId: string) {
    return this.riders.claimBulkSubOrderUpiPaid(user.sub, subOrderId);
  }
}
