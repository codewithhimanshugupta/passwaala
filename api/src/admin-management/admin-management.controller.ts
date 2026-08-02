import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@passwaala/shared';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPayload } from '../auth/auth-payload';
import { AdminManagementService } from './admin-management.service';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { AssignCityDto } from './dto/assign-city.dto';

/**
 * AdminManagementController — OWNER-only admin governance surface.
 *
 * @Roles(OWNER) means ONLY the owner (super-admin) can invite/approve/revoke
 * admins — a plain ADMIN cannot (deny-by-default RBAC; plan → "only the owner
 * holds the most sensitive powers"). Separate from /admin (which ADMIN+OWNER
 * share for day-to-day ops).
 */
@Roles(UserRole.OWNER)
@Controller('owner/admins')
export class AdminManagementController {
  constructor(private readonly admins: AdminManagementService) {}

  /** List all admin invites + each invited user's current role/status. */
  @Get()
  list() {
    return this.admins.list();
  }

  /** Invite an admin by phone (PENDING_OWNER_APPROVAL). */
  @Post('invite')
  invite(@CurrentUser() owner: AuthPayload, @Body() dto: InviteAdminDto) {
    return this.admins.invite(owner.sub, dto);
  }

  /** Approve an invite → the user becomes an ADMIN. */
  @Post(':inviteId/approve')
  approve(@CurrentUser() owner: AuthPayload, @Param('inviteId') inviteId: string) {
    return this.admins.approve(owner.sub, inviteId);
  }

  /** Revoke an admin → demoted to CUSTOMER, invite removed. */
  @Post(':inviteId/revoke')
  revoke(@CurrentUser() owner: AuthPayload, @Param('inviteId') inviteId: string) {
    return this.admins.revoke(owner.sub, inviteId);
  }

  /** Assign (or clear) a city for an admin. */
  @Patch(':inviteId/city')
  assignCity(@Param('inviteId') inviteId: string, @Body() dto: AssignCityDto) {
    return this.admins.assignCity(inviteId, dto.cityId ?? null);
  }
}
