import { IsArray, IsEnum, IsOptional, IsString, ValidateNested, ArrayMinSize, ArrayMaxSize, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryMode, PaymentMethod } from '@nearbaz/shared';

class BulkOrderItemDto {
  @IsString()
  productId!: string;

  @IsInt()
  @Min(1)
  qty!: number;
}

class ShopCartDto {
  @IsString()
  shopId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkOrderItemDto)
  @ArrayMinSize(1)
  items!: BulkOrderItemDto[];
}

export class PlaceBulkOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShopCartDto)
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  shops!: ShopCartDto[];

  @IsString()
  addressId!: string;

  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsString()
  idempotencyKey!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  redeemCoins?: number;
}
