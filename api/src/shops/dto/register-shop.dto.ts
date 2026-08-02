import {
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * RegisterShopDto — body for POST /shops (a logged-in user registers their
 * shop, becoming a SHOPKEEPER).
 *
 * SECURITY: verificationStatus, commissionRate, creditLimit, ownerId, etc. are
 * NEVER accepted here — they are server-controlled. A new shop always starts
 * DRAFT and is hidden until an admin approves it. Only the fields a shopkeeper
 * legitimately provides are on this DTO (ValidationPipe strips the rest).
 */
export class RegisterShopDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  /** kirana / dairy / medical / fruits-veg / electronics / clothing / hardware ... */
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  shopCategory!: string;

  /** Required real photo of the physical storefront (anti-fraud gate). */
  @IsUrl({ require_tld: false })
  storefrontPhotoUrl!: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  /** Optional branding. */
  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  bannerUrl?: string;

  /** The shop's own UPI VPA for direct customer→shop payment. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  upiVpa?: string;

  /** Public profile shown to customers. */
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

  /** Shop economics (integer paise). Optional at registration; editable later. */
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

  /** Whether the shop uses the PassWaala rider network. */
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
}
