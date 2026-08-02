import { IsInt, IsString, Max, Min } from 'class-validator';

/**
 * AddToCartDto — body for POST /cart/items. The single-shop-cart rule is
 * enforced server-side (adding a product from a different shop than the current
 * cart requires clearing it first). shopId is derived from the product, not
 * trusted from the client.
 */
export class AddToCartDto {
  @IsString()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(99)
  qty!: number;
}
