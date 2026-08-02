import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';

/**
 * FeedQuery — query params for GET /orders/feed. Extends the shared pagination
 * params (limit, cursor) with an optional `status` filter (a comma-separated
 * status set = the shopkeeper UI tab). Declaring `status` here whitelists it so
 * the global forbidNonWhitelisted pipe doesn't 400 on it.
 */
export class FeedQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  override status?: string;
}
