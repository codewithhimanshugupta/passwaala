import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  UserRole,
  CreatePrescription,
  QuotePrescription,
  RejectPrescription,
} from '@passwaala/shared';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, ShopId } from '../common/current-user.decorator';
import { AuthPayload } from '../auth/auth-payload';
import { PrescriptionsService } from './prescriptions.service';

/**
 * PrescriptionsController — medical-store prescription flow.
 *
 * Customer routes are CUSTOMER-scoped (own uploads); shop routes are SHOPKEEPER-
 * scoped from the JWT (@ShopId), never client input. Static paths are declared
 * before ':id' so they aren't captured as an id param.
 */
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly prescriptions: PrescriptionsService) {}

  /** Customer: upload a prescription to a medical shop. */
  @Roles(UserRole.CUSTOMER)
  @Post()
  create(@CurrentUser() user: AuthPayload, @Body() dto: CreatePrescription) {
    return this.prescriptions.create(user.sub, dto);
  }

  /** Customer: their own prescriptions. */
  @Roles(UserRole.CUSTOMER)
  @Get('mine')
  mine(@CurrentUser() user: AuthPayload) {
    return this.prescriptions.myPrescriptions(user.sub);
  }

  /** Shop: its prescription queue (SHOPKEEPER, own shop). */
  @Roles(UserRole.SHOPKEEPER)
  @Get('shop')
  shopQueue(@ShopId() shopId: string | undefined) {
    return this.prescriptions.shopPrescriptions(shopId);
  }

  /** Shop: build the itemized bill → creates the Order (UPI_DIRECT, AWAITING_PAYMENT). */
  @Roles(UserRole.SHOPKEEPER)
  @Post(':id/quote')
  quote(
    @ShopId() shopId: string | undefined,
    @Param('id') id: string,
    @Body() dto: QuotePrescription,
  ) {
    return this.prescriptions.quote(shopId, id, dto);
  }

  /** Shop: reject a prescription it cannot fulfil. */
  @Roles(UserRole.SHOPKEEPER)
  @Post(':id/reject')
  reject(
    @ShopId() shopId: string | undefined,
    @Param('id') id: string,
    @Body() dto: RejectPrescription,
  ) {
    return this.prescriptions.reject(shopId, id, dto);
  }

  /** Fetch one prescription — visible to its own customer OR its own shop. */
  @Roles(UserRole.CUSTOMER, UserRole.SHOPKEEPER)
  @Get(':id')
  getOne(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    const ctx =
      user.role === UserRole.SHOPKEEPER
        ? { shopId: user.shopId }
        : { customerId: user.sub };
    return this.prescriptions.getOne(id, ctx);
  }
}
