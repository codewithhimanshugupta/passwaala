import { existsSync, mkdirSync } from 'fs';
import { Module } from '@nestjs/common';
import { UPLOADS_DIR, UploadController } from './upload.controller';

// Ensure the uploads dir exists at boot (idempotent).
if (!existsSync(UPLOADS_DIR)) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * UploadModule — local image upload to ./uploads (dev). The files are served
 * statically by an Express middleware wired in main.ts. Swappable for R2/CDN
 * later behind the same URL contract.
 */
@Module({
  controllers: [UploadController],
})
export class UploadModule {}
