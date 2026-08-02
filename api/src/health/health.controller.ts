import { Controller, Get } from '@nestjs/common';
import { OrderStatus, canTransition } from '@passwaala/shared';
import { Public } from '../common/public.decorator';

/**
 * HealthController — trivial liveness endpoint.
 *
 * Added by the Phase 0 verifier. It imports from @passwaala/shared on purpose so
 * the API build genuinely exercises the cross-package workspace dependency
 * (proving the built shared dist + types resolve from the API), rather than the
 * empty-src vacuous "build" that was delivered.
 *
 * @Public() so the global JwtAuthGuard lets liveness checks through without a
 * bearer token.
 */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: string; sampleTransitionOk: boolean } {
    // Uses shared logic so the import is not tree-shaken away.
    const sampleTransitionOk = canTransition(
      OrderStatus.PLACED,
      OrderStatus.ACCEPTED,
    );
    return { status: 'ok', sampleTransitionOk };
  }
}
