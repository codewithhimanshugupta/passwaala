import { IsIn, IsOptional } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';

/**
 * Query for GET /orders/history. Extends the shared keyset pagination params
 * with an optional `mode` tab filter — `ongoing` (non-terminal orders) or
 * `history` (terminal). Declared here (not on the shared PaginationQuery) so the
 * global whitelist validator accepts `mode` on THIS endpoint only.
 */
export class OrderHistoryQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(['ongoing', 'history'])
  mode?: 'ongoing' | 'history';
}
