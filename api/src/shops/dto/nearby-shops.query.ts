import { IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * NearbyShopsQuery — query params for GET /shops/nearby (customer discovery).
 * Drives the PostGIS ST_DWithin radius query + sort/filters (plan → Home &
 * Discovery). All coercion via class-transformer (query strings → numbers).
 */
export class NearbyShopsQuery {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  /** Search radius in metres (default 3000, max 20000). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(20000)
  radiusMeters?: number;

  /** Sort order: distance (default) or rating. */
  @IsOptional()
  @IsIn(['distance', 'rating'])
  sort?: 'distance' | 'rating';

  /** Filter: only currently-open shops. */
  @IsOptional()
  @IsIn(['true', 'false'])
  openNow?: string;

  /** Filter: shop category (kirana / dairy / ...). */
  @IsOptional()
  @IsString()
  category?: string;

  /**
   * City filter — the FIRST filter applied so the query prunes to the customer's
   * serviceable city before the radius/sort work (keeps discovery fast as the
   * platform grows to many cities). Case-insensitive match on Shop.city.
   */
  @IsOptional()
  @IsString()
  city?: string;

  /** Filter: only shops currently running an offer ("Great Offers" pill). */
  @IsOptional()
  @IsIn(['true', 'false'])
  hasOffers?: string;

  /** Filter: minimum average rating (0..5). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  minRating?: number;

  /** Pagination: max results to return (default 15, max 50). */
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

  /**
   * Optional requesting customer id — used ONLY to personalize ranking (a small
   * additive boost for the customer's favourite shop categories). Never a
   * data-access key, so a spoofed value only re-ranks that caller's own list.
   */
  @IsOptional()
  @IsString()
  customerId?: string;
}
