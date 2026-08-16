import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@nearbaz/shared';

/**
 * @Roles(...) — attach the allowed roles to a route/controller.
 * Consumed by RolesGuard. Deny-by-default: a route with no @Roles and no
 * @Public is treated as authenticated-any-role by the guard's policy below.
 *
 * Security rule (plan → Security & Data Protection): RBAC on every endpoint,
 * and NO public path may ever create/elevate ADMIN or OWNER.
 */
export const ROLES_KEY = 'nearbaz:roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
