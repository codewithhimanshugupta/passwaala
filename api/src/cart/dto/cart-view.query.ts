import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DeliveryMode } from '@passwaala/shared';

/**
 * CartViewQuery — optional query params for GET /cart so the checkout can
 * preview the exact delivery fee the server will charge. `deliveryMode` +
 * `addressId` drive the distance-tiered fee for PLATFORM_RIDER; both optional
 * (a bare GET /cart previews the shop's flat fee). Declared here so the global
 * forbidNonWhitelisted pipe doesn't reject the params.
 */
export class CartViewQuery {
  @IsOptional()
  @IsEnum(DeliveryMode)
  deliveryMode?: DeliveryMode;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  addressId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  selectedOfferId?: string;
}
