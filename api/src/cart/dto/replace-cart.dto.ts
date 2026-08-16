import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DeliveryMode } from '@nearbaz/shared';

/** A single line in a bulk cart replace. */
export class ReplaceCartItemDto {
  @IsString()
  @MaxLength(64)
  productId!: string;

  @IsInt()
  @Min(1)
  qty!: number;
}

/**
 * ReplaceCartDto — body for POST /cart/replace. Sets the whole cart in one call
 * (shop + all lines), plus the optional fee-preview params (same as GET /cart)
 * so the returned view shows the exact delivery fee for the chosen fulfilment.
 */
export class ReplaceCartDto {
  @IsString()
  @MaxLength(64)
  shopId!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReplaceCartItemDto)
  items!: ReplaceCartItemDto[];

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
