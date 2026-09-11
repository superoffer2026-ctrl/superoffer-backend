import { FileInterceptor } from '@nestjs/platform-express';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { diskStorage } from 'multer';

const INBOX = join(process.cwd(), 'uploads', 'media', '_incoming');
if (!existsSync(INBOX)) mkdirSync(INBOX, { recursive: true });

const ALLOWED = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

/**
 * Accepts one image and drops it in a staging folder.
 *
 * The storage layer moves it from there and decides its reference, so this
 * interceptor stays ignorant of where images finally live — the same shape works
 * whether that is disk or a bucket.
 */
export const imageUploadInterceptor = () =>
  FileInterceptor('file', {
    storage: diskStorage({
      destination: INBOX,
      filename: (_req, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname)}`)
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      const ext = extname(file.originalname).toLowerCase();
      if (!ALLOWED.includes(ext)) {
        return callback(new BadRequestException({
          code: 'UNSUPPORTED_IMAGE',
          message: `Upload a ${ALLOWED.join(', ')} image`
        }), false);
      }
      callback(null, true);
    }
  });
