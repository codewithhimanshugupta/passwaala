import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { prisma } from './db';

/**
 * Boots a full Nest application for integration tests, configured to MIRROR
 * production bootstrap (src/main.ts): the same global ValidationPipe and the
 * global guards from AppModule (JwtAuthGuard + RolesGuard). This way e2e tests
 * exercise the real security surface — auth, RBAC, validation — end to end.
 *
 * The app's PrismaService is overridden to reuse the test client (test/db.ts),
 * so the app and the test's own queries/truncation share one connection pool
 * against passwala_test.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}
