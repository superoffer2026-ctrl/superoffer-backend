import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { LocalMediaStorage } from './media.storage';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

/**
 * Serves the images an organisation uploaded.
 *
 * Deliberately unauthenticated: a university logo appears on an offer a student
 * is reading, and gating it behind a token would mean every image needing a
 * signed fetch to render. Nothing private is served here — only what an
 * organisation published about itself.
 *
 * Once images live in a bucket this becomes a redirect, and the route stays.
 */
@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private storage: LocalMediaStorage) {}

  /**
   * Two explicit segments rather than a wildcard.
   *
   * Every reference this layer mints is `folder/name` and nothing deeper, and
   * Express 5 does not match the wildcard form the way Express 4 did — the route
   * registered but never fired. Naming the segments is both simpler and exact.
   */
  @Get(':folder/:name')
  serve(@Param('folder') folder: string, @Param('name') name: string, @Res() response: Response) {
    const key = `${folder}/${name}`;
    const ref = `local/${key}`;
    const stream = this.storage.stream(ref);
    if (!stream) throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'No such image' });

    const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
    response.setHeader('content-type', CONTENT_TYPES[ext] || 'application/octet-stream');
    /** Content-addressed by a random name, so it never changes under a cached copy. */
    response.setHeader('cache-control', 'public, max-age=31536000, immutable');
    stream.pipe(response);
  }
}
