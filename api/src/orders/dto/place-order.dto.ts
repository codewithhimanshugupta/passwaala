import { IsArray, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryMode, PaymentMethod } from '@passwaala/shared';

/** One line of a client-side cart sent at placement. */
export class PlaceOrderItemDto {
  @IsString()
  productId!: string;

  @IsInt()
  @Min(1)
  qty!: number;
}

/**
 * PlaceOrderDto — body for POST /orders. The order is built server-side from the
 * customer's cart (items + shop); the client supplies fulfilment mode, payment
 * method, an address (delivery only), and an idempotency key.
 *
 * The idempotencyKey guarantees exactly-once placement (plan → Order Reliability).
 */
export class PlaceOrderDto {
  /**
   * Delivery address UUID — required for SELF_DELIVERY, optional for SELF_PICKUP
   * (the customer collects from the shop). Validated in the service by mode.
   */
  @IsOptional()
  @IsString()
  addressId?: string;

  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  /** Fulfilment mode. Defaults to SELF_DELIVERY when omitted. */
  @IsOptional()
  @IsEnum(DeliveryMode)
  deliveryMode?: DeliveryMode;

  /** Client-generated key so retries never create a duplicate order. */
  @IsString()
  @MaxLength(120)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  /**
   * NearBaz Coins to redeem as a discount (1 coin = ₹1). Applied to the item
   * subtotal only; capped server-side by the customer's balance AND the
   * subtotal. Omit or 0 for no redemption.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  redeemCoins?: number;

  /** Optional offer template the customer wants to apply. Server validates it
   * belongs to the shop's city and is active. */
  @IsOptional()
  @IsString()
  offerId?: string;

  /**
   * Optional coupon code the customer wants to apply. MUTUALLY EXCLUSIVE with
   * offerId and with any second coupon — a single order carries at most ONE
   * discount source (enforced server-side). Resolves to either a shop-funded or a
   * NearBaz-funded (platform) coupon; server validates city/shop scope + limits.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  couponCode?: string;

  /**
   * CLIENT-CART path: the shop + items the customer built locally. When present,
   * the order is placed from these (server still re-validates stock/price/shop);
   * when absent, the order falls back to the server-side cart (legacy path).
   */
  @IsOptional()
  @IsString()
  shopId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlaceOrderItemDto)
  items?: PlaceOrderItemDto[];
}
