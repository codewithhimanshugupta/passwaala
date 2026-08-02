import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { UPLOADS_DIR } from './uploads/upload.controller';

/**
 * API bootstrap. Added by the Phase 0 verifier (api/src/ was delivered empty).
 * Locked-down CORS from env (never "*") and helmet, per the plan's security
 * section. Not run in Phase 0 verification (no DB), but it compiles.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // helmet with cross-origin resource policy relaxed so uploaded images load in
  // the web apps (different origin/port) during local dev.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // Serve uploaded media statically at /uploads/<filename> (local dev storage;
  // swappable for R2/CDN in prod — the URL contract stays the same).
  app.useStaticAssets(UPLOADS_DIR, { prefix: '/uploads/' });

  // Global input validation (plan → Security: "input validation on every
  // endpoint"). whitelist strips unknown props; forbidNonWhitelisted rejects
  // them (blocks a client smuggling e.g. a `role` field); transform coerces
  // payloads into the DTO classes.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins.length ? corsOrigins : false });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
