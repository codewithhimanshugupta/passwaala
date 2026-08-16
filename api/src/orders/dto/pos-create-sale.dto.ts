import { IsArray, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '@passwaala/shared';

/**
 * One line of an in-store POS (counter) sale. EITHER a catalog product
 * (productId — stock decremented + price re-validated server-side) OR a
 * free-text line (name + pricePaise) the shopkeeper types in.
 */
export class POSSaleItemDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** Unit price in paise (free-text line only; ignored for catalog lines). */
  @IsOptional()
  @IsInt()
  @Min(0)
  pricePaise?: number;

  @IsInt()
  @Min(1)
  qty!: number;
}

/**
 * POSCreateSaleDto — body for POST /orders/pos (shopkeeper only). The shopId is
 * taken from the JWT (@ShopId), never the body. The sale is created directly at
 * DELIVERED, paid CASH, commission-free. idempotencyKey guarantees exactly-once
 * placement across offline replays.
 */
export class POSCreateSaleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => POSSaleItemDto)
  items!: POSSaleItemDto[];

  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsOptional()
  @IsInt()
  @Min(0)
  cashTenderedPaise?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @IsString()
  @MaxLength(120)
  idempotencyKey!: string;
}
