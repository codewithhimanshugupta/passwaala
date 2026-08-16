import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@nearbaz/shared';
import { prisma } from './db';

/**
 * Test auth helpers — create real User rows and mint valid JWTs the same way
 * AuthService does, so integration tests can hit protected routes with a proper
 * bearer token (role + optional shopId from the signed token, never faked in
 * the request body).
 */

let counter = 0;

/** Create a User with the given role and return { userId, token, phone }. */
export async function createUser(
  app: INestApplication,
  role: UserRole = UserRole.CUSTOMER,
  shopId?: string,
): Promise<{ userId: string; token: string; phone: string }> {
  const jwt = app.get(JwtService);
  counter += 1;
  // Unique per row: 10 digits starting with 9, from a monotonic counter. Each
  // test truncates the DB first (resetDb), so the counter never needs to be
  // globally unique — just unique within a test.
  const phone = `+91${String(9000000000 + counter)}`;
  const user = await prisma.user.create({ data: { phone, role } });
  const payload: Record<string, unknown> = { sub: user.id, role };
  if (shopId) payload.shopId = shopId;
  const token = await jwt.signAsync(payload);
  return { userId: user.id, token, phone };
}

/** Authorization header tuple for supertest .set(...). */
export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}
