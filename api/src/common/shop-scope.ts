import { ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * Shop Data Isolation helpers (plan → "Shop Data Isolation", a HARD security
 * rule). A shopkeeper can only ever see/touch their OWN shop's rows. These
 * helpers centralize the enforcement so a single forgotten `where` clause can't
 * leak another shop's data.
 *
 * The caller's shopId ALWAYS comes from the authenticated JWT (@ShopId()),
 * never from client input.
 */

/**
 * Require that the request carries a shop scope (a SHOPKEEPER token with a
 * shopId). Returns the shopId or throws 403. Use at the top of every shop-owned
 * service method.
 */
export function requireShopScope(shopId: string | undefined): string {
  if (!shopId) {
    throw new ForbiddenException('No shop scope on this account');
  }
  return shopId;
}

/**
 * Assert a loaded row belongs to the caller's shop (object-level authorization
 * / IDOR guard for `/:id` fetches). If the row is missing OR belongs to another
 * shop, throw 404 — never reveal that another shop's resource exists.
 *
 * Returns the row (narrowed to non-null) so callers can use it directly.
 */
export function assertOwnedByShop<T extends { shopId: string } | null>(
  row: T,
  shopId: string,
): NonNullable<T> {
  if (!row || row.shopId !== shopId) {
    throw new NotFoundException('Resource not found');
  }
  return row as NonNullable<T>;
}
