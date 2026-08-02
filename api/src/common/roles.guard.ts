import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@passwaala/shared';
import { ROLES_KEY } from './roles.decorator';

/**
 * RolesGuard — deny-by-default RBAC. Reads the roles required by @Roles(...) and
 * checks them against request.user.role (set by JwtAuthGuard from the signed
 * token). A token for one role can never reach another role's endpoints.
 *
 * Security rule (plan): each user accesses ONLY their role's surface; ADMIN/OWNER
 * are privileged and never reachable via public/customer routes.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @Roles specified → any authenticated user (JwtAuthGuard already ran).
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const role: UserRole | undefined = req.user?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
