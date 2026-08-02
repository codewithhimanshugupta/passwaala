import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolve the city an admin is scoped to, via their ACTIVE AdminInvite.
 * Returns null for OWNER (or an admin with no assigned city) — meaning
 * "all cities" / no scoping. Shared by the dispute queue and the dashboard so
 * city-scoping stays defined in one place.
 */
export async function resolveAdminCity(
  prisma: PrismaService,
  adminId: string,
  role: string,
): Promise<string | null> {
  if (role === 'OWNER') return null;
  const user = await prisma.user.findFirst({
    where: { id: adminId },
    select: { phone: true },
  });
  if (!user?.phone) return null;
  const invite = await prisma.adminInvite.findFirst({
    where: { phone: user.phone, status: 'ACTIVE', deletedAt: null },
    select: { city: { select: { name: true } } },
  });
  return invite?.city?.name ?? null;
}
