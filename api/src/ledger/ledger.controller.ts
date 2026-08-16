import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@nearbaz/shared';
import { Roles } from '../common/roles.decorator';
import { ShopId } from '../common/current-user.decorator';
import { PaginationQuery } from '../common/pagination';
import { LedgerService } from './ledger.service';
import { PayDuesDto } from './dto/pay-dues.dto';
import { PaymentClaimsService } from '../payment-claims/payment-claims.service';
import { ClaimPaymentDto } from '../payment-claims/claim-payment.dto';

/**
 * LedgerController — a shopkeeper reads their OWN ledger + self-pays their dues;
 * an admin records payments (cross-shop).
 *
 * The shopkeeper read + self-pay are scoped to @ShopId() from the token — a shop
 * can never touch another shop's ledger (Shop Data Isolation). record-payment is
 * ADMIN/OWNER-only (settlement power).
 */
@Controller('ledger')
export class LedgerController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly claims: PaymentClaimsService,
  ) {}

  /** Shopkeeper: their own ledger + dues (scope from token), entries paginated. */
  @Roles(UserRole.SHOPKEEPER)
  @Get()
  listForShop(@ShopId() shopId: string | undefined, @Query() page: PaginationQuery) {
    return this.ledger.listForShop(shopId, page);
  }

  /** Shopkeeper: P&L summary (gross sales, discounts, commission, net position). */
  @Roles(UserRole.SHOPKEEPER)
  @Get('pnl')
  pnl(@ShopId() shopId: string | undefined, @Query('since') since?: string) {
    return this.ledger.plnSummaryForShop(shopId, since ? new Date(since) : undefined);
  }

  /**
   * Shopkeeper: self-settle dues over UPI (scope from token). Overpayment allowed
   * (dues may go negative — advance credit). Reactivates a paused shop.
   */
  @Roles(UserRole.SHOPKEEPER)
  @Post('pay')
  payDues(@ShopId() shopId: string | undefined, @Body() dto: PayDuesDto) {
    return this.ledger.settleByShopkeeper(shopId, dto.amountPaise);
  }

  /** Admin: record a shop's payment, flipping dues to PAID + reactivating. */
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Post('record-payment/:shopId')
  recordPayment(@Param('shopId') shopId: string) {
    return this.ledger.recordPayment(shopId);
  }

  /** Shopkeeper: file a payment claim after sending UPI — admin approves to clear dues. */
  @Roles(UserRole.SHOPKEEPER)
  @Post('claim-payment')
  claimPayment(@ShopId() shopId: string | undefined, @Body() dto: ClaimPaymentDto) {
    return this.claims.claimShopPayment(shopId, dto.amountPaise);
  }
}
