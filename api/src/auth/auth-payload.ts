import { UserRole } from '@passwaala/shared';

/**
 * The verified JWT payload attached to request.user by JwtAuthGuard.
 *
 * SECURITY (plan → Shop Data Isolation, RBAC): `role` and `shopId` come ONLY
 * from the signed token, never from client input. `shopId` is present for a
 * SHOPKEEPER (their own shop) and is the single source of shop scope for every
 * shop-owned query — @ShopId() reads it, and services must filter by it.
 */
export interface AuthPayload {
  /** User UUID (JWT standard `sub` claim). */
  sub: string;
  /** The user's role (server-assigned, never client-supplied). */
  role: UserRole;
  /** The shopkeeper's own shop id, when they own one. Absent for other roles. */
  shopId?: string;
}
