import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * SearchProductsQuery — query params for GET /products/search (cross-shop
 * product search near a location). Drives a PostGIS ST_DWithin radius join over
 * APPROVED shops, ranked by shop distance. Coercion via class-transformer.
 */
export class SearchProductsQuery {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  /** The search term (product name, case-insensitive contains). */
  @IsString()
  @MinLength(2)
  q!: string;

  /** Search radius in metres (default 5000, max 20000). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(20000)
  radiusMeters?: number;

  /**
   * City filter — applied FIRST so the search prunes to the customer's
   * serviceable city before the radius join (keeps cross-shop search fast as
   * the catalog grows to many cities). Case-insensitive match on Shop.city.
   */
  @IsOptional()
  @IsString()
  city?: string;

  /** Pagination: max results to return (default 5, max 50 — a few shown first). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** Pagination: how many results to skip (for load-more on scroll). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
