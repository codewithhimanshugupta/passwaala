import { randomUUID } from 'crypto';
import { extname } from 'path';
import { mkdirSync } from 'fs';
import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { UserRole } from '@passwaala/shared';

/** Minimal shape of an uploaded file (subset of Express.Multer.File we use). */
interface UploadedFileShape {
  filename: string; // may include a subfolder prefix, e.g. "shops/<id>/x.jpg"
  originalname: string;
  mimetype: string;
  size: number;
}
import { Roles } from '../common/roles.decorator';

/** Absolute path to the local uploads dir (configurable via UPLOADS_DIR). */
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? `${process.cwd()}/uploads`;

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

/** Upload categories → top-level folder under uploads/. Anything else → "misc". */
const CATEGORY_DIRS: Record<string, string> = {
  shop: 'shops',
  product: 'products',
  kyc: 'kyc',
  prescription: 'prescriptions',
  banner: 'banners',
  misc: 'misc',
};

/** Sanitise an id/segment so it can't escape the uploads dir (no slashes/dots). */
function safeSegment(v: string | undefined): string {
  if (!v) return '';
  return v.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

/**
 * Resolve the relative subfolder for an upload from ?type=&scopeId=.
 *   type=shop    scopeId=<shopId>  → shops/<shopId>
 *   type=product scopeId=<shopId>  → products/<shopId>
 *   type=kyc     scopeId=<shopId>  → kyc/<shopId>
 * Missing/unknown type → misc. Missing scopeId → just the category folder.
 */
function subfolderFor(type?: string, scopeId?: string): string {
  const cat = CATEGORY_DIRS[type ?? 'misc'] ?? 'misc';
  const id = safeSegment(scopeId);
  return id ? `${cat}/${id}` : cat;
}

/**
 * UploadController — local media upload, organised into per-category, per-shop
 * folders (shops/<id>, products/<id>, kyc/<id>) so files are easy to track
 * instead of one flat pile. Local ./uploads in dev behind a swappable interface;
 * R2/CDN later (same URL contract). Random filename avoids collisions/traversal;
 * only image extensions, capped at 5 MB.
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
        destination: (req, _file, cb) => {
          const q = (req.query ?? {}) as { type?: string; scopeId?: string };
          const rel = subfolderFor(q.type, q.scopeId);
          const dir = `${UPLOADS_DIR}/${rel}`;
          try {
            mkdirSync(dir, { recursive: true });
            cb(null, dir);
          } catch (e) {
            cb(e as Error, dir);
          }
        },
        filename: (req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          const q = (req.query ?? {}) as { type?: string; scopeId?: string };
          // Store the relative path in `filename` so the URL keeps the subfolder.
          const rel = subfolderFor(q.type, q.scopeId);
          cb(null, `${rel}/${randomUUID()}${ext}`);
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
  uploadImage(
    @UploadedFile() file?: UploadedFileShape,
    @Query('type') _type?: string,
    @Query('scopeId') _scopeId?: string,
  ): { url: string; filename: string } {
    if (!file) {
      throw new BadRequestException('No file uploaded (field name must be "file")');
    }
    // multer's diskStorage put the file at UPLOADS_DIR but `filename` may hold a
    // subfolder path; the destination fn already created that folder. The public
    // URL keeps the subfolder so it resolves via ServeStaticModule at /uploads/.
    const base = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    return { url: `${base}/uploads/${file.filename}`, filename: file.filename };
  }
}
