import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Default + max page size for cursor-paginated list endpoints. The client asks
 * for `limit` rows; we cap it so a caller can't request the whole table.
 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * PaginationQuery — shared query params for keyset (cursor) pagination. Used via
 * `@Query() page: PaginationQuery` on list endpoints. Cursor-based (not offset)
 * so newly-inserted top rows don't shift the page window. The cursor is an
 * opaque row id; the service pairs it with a stable `orderBy` (createdAt desc,
 * id desc). Coercion via class-transformer (query strings → number).
 */
export class PaginationQuery {
  /** Page size (default 20, max 100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  /** Opaque cursor: the id of the last row from the previous page. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  /** Optional status filter (used by admin order list). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;
}

/** A page of results + the cursor to fetch the next page (null when exhausted). */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** Clamp a requested limit into [1, MAX_PAGE_SIZE], defaulting when absent. */
export function pageSize(limit?: number): number {
  if (!limit || limit < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}

/**
 * Build the Prisma `take`/`cursor`/`skip` fragment for a keyset page. Fetches
 * `size + 1` rows so the caller can tell whether a next page exists without a
 * separate count query.
 */
export function cursorArgs(limit?: number, cursor?: string) {
  const size = pageSize(limit);
  return {
    take: size + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

/**
 * Slice a `size + 1` row fetch into a `Paginated<T>`: trims the sentinel extra
 * row and returns its predecessor's id as `nextCursor`. `getId` extracts the
 * cursor field from a row (defaults to `row.id`).
 */
export function toPage<T extends { id: string }>(
  rows: T[],
  limit?: number,
  getId: (row: T) => string = (row) => row.id,
): Paginated<T> {
  const size = pageSize(limit);
  if (rows.length <= size) {
    return { items: rows, nextCursor: null };
  }
  const items = rows.slice(0, size);
  return { items, nextCursor: getId(items[items.length - 1]) };
}
