import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { decryptField, encryptField } from '../common/field-crypto';

/**
 * Where a partner bank's bureau certificate actually lives.
 *
 * The database never holds the material — only a reference — so a database dump
 * cannot be used to impersonate a bank at a credit bureau. That separation is
 * the point of this class, and it holds whichever backing store is configured.
 *
 * `SECRET_STORE=file` keeps envelope-encrypted blobs on disk under
 * `SECRET_STORE_DIR`, which is enough for development and for a single host. A
 * managed store — AWS Secrets Manager, Azure Key Vault, Vault — implements the
 * same three methods and is what production should use, because it brings the
 * two things a file cannot: access logging, and rotation that does not require
 * a deploy.
 */
export interface SecretStore {
  /** Stores material and returns the reference to keep in the database. */
  put(ref: string, material: string): Promise<string>;
  /** Reads material back. Only ever called on the way to a bureau. */
  get(ref: string): Promise<string>;
  /** Removes it, for a rotation or a partner leaving. */
  remove(ref: string): Promise<void>;
}

@Injectable()
export class FileSecretStore implements SecretStore {
  private readonly logger = new Logger(FileSecretStore.name);
  private readonly dir = process.env.SECRET_STORE_DIR || path.join(process.cwd(), '.secrets');

  constructor() {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    }
    if (process.env.NODE_ENV === 'production') {
      this.logger.warn(
        'Bureau certificates are being kept on local disk. Point SECRET_STORE at a managed store before going live: ' +
          'a file gives no access log and no rotation without a deploy.'
      );
    }
  }

  /** A reference that reveals nothing about whose certificate it is. */
  static reference(): string {
    return `bureau/${crypto.randomUUID()}`;
  }

  private fileFor(ref: string): string {
    /** A reference is generated, never supplied — but path traversal is cheap to rule out. */
    const safe = crypto.createHash('sha256').update(ref).digest('hex');
    return path.join(this.dir, `${safe}.enc`);
  }

  async put(ref: string, material: string): Promise<string> {
    await fs.promises.writeFile(this.fileFor(ref), encryptField(material), { mode: 0o600 });
    return ref;
  }

  async get(ref: string): Promise<string> {
    const stored = await fs.promises.readFile(this.fileFor(ref), 'utf8');
    return decryptField(stored);
  }

  async remove(ref: string): Promise<void> {
    await fs.promises.rm(this.fileFor(ref), { force: true });
  }
}
