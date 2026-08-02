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

  /** Filter: minimum average rating (0..5). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  minRating?: number;
}
