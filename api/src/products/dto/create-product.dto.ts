import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * CreateProductDto — body for POST /products (shopkeeper creates a product in
 * their OWN shop). shopId is NEVER on this DTO — it comes from the JWT scope.
 * Prices are integer paise (schema rule #4).
 */
export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** Selling price in paise (₹10 = 1000). */
  @IsInt()
  @Min(0)
  pricePaise!: number;

  /** MRP in paise for strike-through display. */
  @IsInt()
  @Min(0)
  mrpPaise!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsUrl({ require_tld: false })
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  available?: boolean;

  /** Weight in grams — required for new products (used for multi-rider dispatch above 20 kg). */
  @IsInt()
  @Min(1)
  weightGrams!: number;

  /** Optional category (must belong to the same shop — validated server-side). */
  @IsOptional()
  @IsString()
  categoryId?: string;
}
