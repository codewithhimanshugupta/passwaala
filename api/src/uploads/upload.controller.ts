import { randomUUID } from 'crypto';
import { extname } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import {
  BadRequestException,
  Controller,
  InternalServerErrorException,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UserRole } from '@passwaala/shared';

/** Minimal shape of an in-memory uploaded file (subset of Express.Multer.File). */
interface UploadedFileShape {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
import { Roles } from '../common/roles.decorator';

/** Absolute path to the local uploads dir (dev fallback only; configurable). */
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? `${process.cwd()}/uploads`;

/** Supabase Storage config (prod). When SUPABASE_URL is unset we fall back to
 *  writing to the local disk (dev). */
const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? 'uploads';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

/** Upload categories → top-level folder under the bucket. Anything else → "misc". */
const CATEGORY_DIRS: Record<string, string> = {
  shop: 'shops',
  product: 'products',
  kyc: 'kyc',
  prescription: 'prescriptions',
  banner: 'banners',
  misc: 'misc',
};

/** Sanitise an id/segment so it can't escape the folder (no slashes/dots). */
function safeSegment(v: string | undefined): string {
  if (!v) return '';
  return v.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

/**
 * Resolve the relative subfolder for an upload from ?type=&scopeId=.
 *   type=shop    scopeId=<shopId>  → shops/<shopId>
 *   type=product scopeId=<shopId>  → products/<shopId>
 * Missing/unknown type → misc. Missing scopeId → just the category folder.
 */
function subfolderFor(type?: string, scopeId?: string): string {
  const cat = CATEGORY_DIRS[type ?? 'misc'] ?? 'misc';
  const id = safeSegment(scopeId);
  return id ? `${cat}/${id}` : cat;
}

/**
 * Upload a buffer to Supabase Storage via its REST API (no SDK dependency —
 * global fetch). The bucket must be public so the returned URL resolves without
 * a signed token. Returns the public URL.
 */
async function uploadToSupabase(
  relPath: string,
  buffer: Buffer,
  mime: string,
): Promise<string> {
  const endpoint = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${relPath}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
      'Content-Type': mime || 'application/octet-stream',
      'x-upsert': 'true',
      'cache-control': '31536000',
    },
    body: new Uint8Array(buffer),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase upload failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${relPath}`;
}

/**
 * UploadController — image upload to durable object storage. In prod, files go
 * to Supabase Storage (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set) and the
 * returned URL is a public CDN URL. In dev (no Supabase env) it falls back to
 * the local ./uploads dir served by ServeStatic at /uploads/. Random filename
 * avoids collisions/traversal; only image extensions, capped at 5 MB.
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
      // Buffer in memory so we can stream the bytes to object storage. Images
      // are capped at 5 MB so this is safe.
      storage: memoryStorage(),
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
  async uploadImage(
    @UploadedFile() file?: UploadedFileShape,
    @Query('type') type?: string,
    @Query('scopeId') scopeId?: string,
  ): Promise<{ url: string; filename: string }> {
    if (!file) {
      throw new BadRequestException('No file uploaded (field name must be "file")');
    }
    const ext = extname(file.originalname).toLowerCase();
    const rel = `${subfolderFor(type, scopeId)}/${randomUUID()}${ext}`;

    if (USE_SUPABASE) {
      try {
        const url = await uploadToSupabase(rel, file.buffer, file.mimetype);
        return { url, filename: rel };
      } catch (e) {
        throw new InternalServerErrorException(
          e instanceof Error ? e.message : 'Upload failed',
        );
      }
    }

    // Dev fallback: write to the local uploads dir, served at /uploads/.
    try {
      const dir = `${UPLOADS_DIR}/${subfolderFor(type, scopeId)}`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${UPLOADS_DIR}/${rel}`, file.buffer);
    } catch (e) {
      throw new InternalServerErrorException(
        e instanceof Error ? e.message : 'Upload failed',
      );
    }
    const base = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    return { url: `${base}/uploads/${rel}`, filename: rel };
  }
}
