import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderStatus } from '@nearbaz/shared';

/**
 * AdvanceOrderDto — body for PATCH /orders/:id/status (shopkeeper advances an
 * order through the lifecycle). The target status is validated against the
 * shared state machine server-side (canTransition); a reason is required when
 * rejecting.
 */
export class AdvanceOrderDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  /** Required when status = REJECTED (out of stock / closing / too busy). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  /** Required when status = DELIVERED — the handoff OTP shown in the customer app. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  otp?: string;
}
