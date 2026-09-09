import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Where an uploaded image lives, without anything else needing to know.
 *
 * A stored reference is opaque: `local/logos/<uuid>.png` today, an S3 object key
 * tomorrow. Nothing outside this file parses one, so moving to cloud storage
 * means adding an implementation of this interface rather than rewriting every
 * row, endpoint and screen that touches an image.
 */
export interface MediaStorage {
  /** Takes a file already written by the upload interceptor; returns its reference. */
  keep(localPath: string, folder: MediaFolder, originalName: string): Promise<string>;
  /** A URL the browser can load. Relative today; absolute when a CDN serves them. */
  urlFor(ref: string | null | undefined): string | null;
  remove(ref: string | null | undefined): Promise<void>;
  /** Only a local store can stream from disk; a cloud one redirects instead. */
  localPathFor(ref: string): string | null;
}

export type MediaFolder = 'logos' | 'covers' | 'programs';

const ROOT = join(process.cwd(), 'uploads', 'media');
const PREFIX = 'local/';

/**
 * Disk-backed storage, which is enough for the MVP.
 *
 * References are stored prefixed, so a row written today is still recognisable
 * once a second backend exists — the resolver can tell where a given image lives
 * instead of assuming every reference belongs to whichever store is current.
 */
@Injectable()
export class LocalMediaStorage implements MediaStorage {
  constructor(private config: ConfigService) {}

  async keep(localPath: string, folder: MediaFolder, originalName: string): Promise<string> {
    const dir = join(ROOT, folder);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const name = `${randomUUID()}${extname(originalName).toLowerCase()}`;
    const { renameSync } = await import('node:fs');
    renameSync(localPath, join(dir, name));
    return `${PREFIX}${folder}/${name}`;
  }

  urlFor(ref: string | null | undefined): string | null {
    if (!ref) return null;
    const base = (this.config.get<string>('MEDIA_PUBLIC_BASE_URL') || '').replace(/\/+$/, '');
    return `${base}/media/${ref.startsWith(PREFIX) ? ref.slice(PREFIX.length) : ref}`;
  }

  localPathFor(ref: string): string | null {
    if (!ref.startsWith(PREFIX)) return null;
    /** Normalised and re-checked, so a crafted reference cannot climb out of the folder. */
    const resolved = normalize(join(ROOT, ref.slice(PREFIX.length)));
    return resolved.startsWith(ROOT) ? resolved : null;
  }

  async remove(ref: string | null | undefined): Promise<void> {
    if (!ref) return;
    const path = this.localPathFor(ref);
    if (path && existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        /** A file that will not delete must not fail the request that replaced it. */
      }
    }
  }

  stream(ref: string) {
    const path = this.localPathFor(ref);
    return path && existsSync(path) ? createReadStream(path) : null;
  }
}
