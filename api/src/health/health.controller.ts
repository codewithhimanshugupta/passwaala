import { Controller, Get } from '@nestjs/common';
import { OrderStatus, canTransition } from '@nearbaz/shared';
import { Public } from '../common/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * HealthController — liveness endpoint that also warms the DB connection.
 *
 * Added by the Phase 0 verifier. It imports from @nearbaz/shared on purpose so
 * the API build genuinely exercises the cross-package workspace dependency.
 *
 * @Public() so the global JwtAuthGuard lets liveness checks through without a
 * bearer token. The keep-alive pinger hits this every ~10 min; issuing a trivial
 * DB query here keeps the pooled Postgres connection WARM (a cold reconnect costs
 * ~400ms+), so the first real user request doesn't pay that penalty.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<{ status: string; sampleTransitionOk: boolean; db: boolean }> {
    const sampleTransitionOk = canTransition(
      OrderStatus.PLACED,
      OrderStatus.ACCEPTED,
    );
    let db = false;
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      db = true;
    } catch {
      /* DB unreachable — still report liveness so the app isn't marked down */
    }
    return { status: 'ok', sampleTransitionOk, db };
  }
}
