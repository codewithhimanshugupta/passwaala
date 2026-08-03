import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min, MinLength } from 'class-validator';

/**
 * UpdateProductDto — body for PATCH /products/:id. All fields optional (partial
 * update). shopId never appears here (JWT scope only). Prices are integer paise.
 */
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  pricePaise?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  mrpPaise?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsUrl({ require_tld: false })
  imageUrl?: string;

  /** Optional longer product detail — loaded lazily on the product-detail view. */
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  available?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  weightGrams?: number;
}
