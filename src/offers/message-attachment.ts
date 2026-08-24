import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { diskStorage } from 'multer';

const ATTACHMENT_DIR = join(process.cwd(), 'uploads', 'message-attachments');
if (!existsSync(ATTACHMENT_DIR)) mkdirSync(ATTACHMENT_DIR, { recursive: true });

/** Same storage rules as student documents: random name on disk, 10 MB ceiling. */
export const messageAttachmentInterceptor = () => FileInterceptor('file', {
  storage: diskStorage({
    destination: ATTACHMENT_DIR,
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${randomUUID()}${extname(file.originalname)}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});
