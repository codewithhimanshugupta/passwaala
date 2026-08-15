import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * UpdateShopSettingsDto — body for PATCH /shops/me/settings. All optional; a
 * shopkeeper edits their economics + public profile + working hours after
 * registration. shopId comes from the JWT, never this body.
 *
 * workingHours shape: { mon: { open: "09:00", close: "21:00" }, ... } — days the
 * shop is open; a missing/empty day means closed that day.
 */
export class UpdateShopSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  upiVpa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  gstin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  stateCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  legalName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFeePaise?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  freeDeliveryAbovePaise?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderValuePaise?: number;

  /** Per-day open/close schedule (auto open/close). */
  @IsOptional()
  @IsObject()
  workingHours?: Record<string, { open: string; close: string }>;

  /** Whether the shop uses the NearBaz rider network. */
  @IsOptional()
  @IsBoolean()
  platformDeliveryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  selfPickupEnabled?: boolean;

  /** Optional short promo shown on the customer home card (display-only). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  offerText?: string;

  /** Active offer template IDs enabled by the shopkeeper (replaces the full list). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  activeOfferIds?: string[] | null;
}
