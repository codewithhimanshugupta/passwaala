import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/** UpsertCityDto — owner adds/updates a serviceable city. */
export class UpsertCityDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^$|^[\w.\-]{2,}@[\w.\-]{2,}$/, { message: 'collectionUpiVpa must be a valid UPI id (e.g. passwala@upi)' })
  @MaxLength(120)
  collectionUpiVpa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  collectionUpiName?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(100000)
  deliveryRadiusMeters?: number;

  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(50000)
  riderCheckRadiusMeters?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  deliveryTiersJson?: string;

  @IsOptional()
  @IsBoolean()
  requireRiderForDelivery?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50000)
  multiShopSurchargePaise?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(50000)
  bulkShopRadiusMeters?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  codMinOrderPaise?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  codMaxPerDay?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  codCancelBlockAfter?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  codCancelWindowDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  codWindowHours?: number;

  // ── Operational config ────────────────────────────────────────────────────

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  autoCancelMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(300)
  riderOfferWindowSec?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxActiveOrdersPerRider?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  shopReminderMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  staleRiderMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(50000)
  nearbyShopsRadiusMeters?: number;

  // ── Fee / commission config ───────────────────────────────────────────────

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  platformFeePaise?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(0.5)
  defaultCommissionRate?: number;

  @IsOptional()
  @IsInt()
  @Min(10000)
  @Max(10000000)
  defaultCreditLimitPaise?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  commissionHolidayDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500000)
  onboardingFeePaise?: number;

  // ── Referral / coin config ────────────────────────────────────────────────

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  referralCustomerCoins?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  referralShopCoins?: number;
}
