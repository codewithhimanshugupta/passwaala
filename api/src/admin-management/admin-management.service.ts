import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AdminInviteStatus, UserRole } from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { InviteAdminDto } from './dto/invite-admin.dto';

/**
 * AdminManagementService — OWNER-only admin governance (plan → Security: "admins
 * require owner approval"; Admin Panel: "admin management (owner-only)").
 *
 * Backs the AdminInvite model with the PENDING_OWNER_APPROVAL → ACTIVE flow:
 *  - invite: find-or-create the User (role stays CUSTOMER) + a PENDING invite.
 *  - approve: mark invite ACTIVE AND promote the user's role to ADMIN (atomic).
 *  - revoke: demote the user back to CUSTOMER + soft-delete the invite.
 * Every action is audit-logged (matches admin.service.ts 'AUDIT' pattern).
 *
 * HARD RULE: no one self-becomes an admin — only the OWNER (enforced by
 * @Roles(OWNER) on the controller) can invite/approve/revoke.
 */
@Injectable()
export class AdminManagementService {
  private readonly logger = new Logger(AdminManagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** List all admin invites with the invited user's current role + status. */
  async list() {
    const invites = await this.prisma.adminInvite.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { city: { select: { id: true, name: true } } },
    });
    // Resolve each invite's user by phone (invite carries phone/email, not a FK
    // to the invited user — the invitedByOwnerId FK is the owner, not the admin).
    const result = [];
    for (const inv of invites) {
      const user = inv.phone
        ? await this.prisma.user.findUnique({
            where: { phone_appType: { phone: inv.phone, appType: 'ADMIN' } },
            select: { id: true, phone: true, role: true },
          })
        : null;
      result.push({
        inviteId: inv.id,
        userId: user?.id ?? null,
        phone: inv.phone,
        email: inv.email,
        role: user?.role ?? null,
        status: inv.status,
        createdAt: inv.createdAt.toISOString(),
        city: inv.city ?? null,
      });
    }
    return result;
  }

  /** Assign (or clear) a city for an admin invite. */
  async assignCity(inviteId: string, cityId: string | null) {
    const invite = await this.prisma.adminInvite.findFirst({
      where: { id: inviteId, deletedAt: null },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    await this.prisma.adminInvite.update({
      where: { id: inviteId },
      data: { cityId },
    });
    this.logger.log(`AUDIT admin.assignCity invite=${inviteId} cityId=${cityId ?? 'null'}`);
  }

  /** Owner invites an admin by phone. Creates the user (CUSTOMER) if new. */
  async invite(ownerId: string, dto: InviteAdminDto) {
    // Normalize: ensure +91 prefix
    const phone = dto.phone.startsWith('+91') ? dto.phone : `+91${dto.phone}`;
    // Find-or-create the invited user (role stays CUSTOMER until approval).
    await this.prisma.user.upsert({
      where: { phone_appType: { phone, appType: 'ADMIN' } },
      update: {},
      create: { phone, role: UserRole.CUSTOMER, appType: 'ADMIN' },
    });

    const existing = await this.prisma.adminInvite.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true, status: true },
    });
    if (existing) {
      throw new ConflictException('An invite already exists for this number');
    }

    const invite = await this.prisma.adminInvite.create({
      data: {
        phone,
        email: dto.email,
        invitedByOwnerId: ownerId,
        status: AdminInviteStatus.PENDING_OWNER_APPROVAL,
      },
    });
    this.logger.log(`AUDIT admin.invite owner=${ownerId} phone=${phone}`);
    return { inviteId: invite.id, status: invite.status };
  }

  /** Owner approves an invite → user becomes an ADMIN. */
  async approve(ownerId: string, inviteId: string) {
    const invite = await this.prisma.adminInvite.findFirst({
      where: { id: inviteId, deletedAt: null },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    if (!invite.phone) {
      throw new BadRequestException('Invite has no phone to promote');
    }

    await this.prisma.$transaction([
      this.prisma.adminInvite.update({
        where: { id: inviteId },
        data: { status: AdminInviteStatus.ACTIVE },
      }),
      this.prisma.user.update({
        where: { phone_appType: { phone: invite.phone, appType: 'ADMIN' } },
        data: { role: UserRole.ADMIN },
      }),
    ]);
    this.logger.log(`AUDIT admin.approve owner=${ownerId} invite=${inviteId} phone=${invite.phone}`);
    return { status: AdminInviteStatus.ACTIVE };
  }

  /** Owner revokes an admin → user demoted to CUSTOMER, invite soft-deleted. */
  async revoke(ownerId: string, inviteId: string) {
    const invite = await this.prisma.adminInvite.findFirst({
      where: { id: inviteId, deletedAt: null },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    const ops: Array<ReturnType<typeof this.prisma.adminInvite.update> | ReturnType<typeof this.prisma.user.update>> = [
      this.prisma.adminInvite.update({
        where: { id: inviteId },
        data: { deletedAt: new Date() },
      }),
    ];
    if (invite.phone) {
      ops.push(
        this.prisma.user.update({
          where: { phone_appType: { phone: invite.phone, appType: 'ADMIN' } },
          data: { role: UserRole.CUSTOMER },
        }),
      );
    }
    await this.prisma.$transaction(ops);
    this.logger.log(`AUDIT admin.revoke owner=${ownerId} invite=${inviteId}`);
    return { revoked: true };
  }
}
