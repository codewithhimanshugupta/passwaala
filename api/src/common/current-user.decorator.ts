import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * @CurrentUser() — pulls the JWT payload ({ sub, role, shopId? }) off the request.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest().user,
);

/**
 * @ShopId() — the SINGLE source of a shopkeeper's shop scope. It reads shopId
 * ONLY from the authenticated token (request.user.shopId), NEVER from client
 * input (params/body/query).
 *
 * This is the enforcement point for the plan's hard "Shop Data Isolation" rule:
 * a shopkeeper request is always scoped to their own shop_id, so it can never
 * read or write another shop's rows — even if an endpoint forgets to filter.
 * Every shop-owned query in services MUST be filtered by this value.
 *
 * TODO (Phase 1): add a Prisma middleware / repository wrapper that auto-injects
 * `where: { shopId }` for shop-owned models so isolation cannot be bypassed by a
 * forgotten filter, plus the CI test asserting shop A gets 403/404 on shop B.
 */
export const ShopId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest().user?.shopId,
);
