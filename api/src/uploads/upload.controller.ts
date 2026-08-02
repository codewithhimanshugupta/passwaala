import { randomUUID } from 'crypto';
import { extname } from 'path';
import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { UserRole } from '@passwaala/shared';

/** Minimal shape of an uploaded file (subset of Express.Multer.File we use). */
interface UploadedFileShape {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}
import { Roles } from '../common/roles.decorator';

/** Absolute path to the local uploads dir (configurable via UPLOADS_DIR). */
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? `${process.cwd()}/uploads`;

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

/**
 * UploadController — local media upload (plan → File/media: local ./uploads in
 * dev behind a swappable interface; R2/CDN later). Any authenticated user may
 * upload (a shopkeeper uploads storefront/product photos, a customer uploads a
 * KYC/UPI-proof image, etc.). Returns a public URL served by ServeStaticModule.
 *
 * Files are stored on disk with a random name to avoid collisions/traversal;
 * only image extensions are accepted, capped at 5 MB.
 */
@Controller('uploads')
export class UploadController {
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SHOPKEEPER,
    UserRole.RIDER,
    UserRole.PROVIDER,
    UserRole.ADMIN,
    UserRole.OWNER,
  )
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED.has(ext)) {
          cb(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadImage(@UploadedFile() file?: UploadedFileShape): { url: string; filename: string } {
    if (!file) {
      throw new BadRequestException('No file uploaded (field name must be "file")');
    }
    // Public URL served statically at /uploads/<filename> (see ServeStaticModule).
    const base = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    return { url: `${base}/uploads/${file.filename}`, filename: file.filename };
  }
}
