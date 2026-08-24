import * as crypto from 'crypto';

/**
 * Encryption for the few fields that must not sit in the database in the clear —
 * a PAN, and anything else that identifies a person to a credit bureau.
 *
 * AES-256-GCM, so a tampered ciphertext fails to decrypt rather than returning
 * something plausible. The stored form is `v1:iv:tag:ciphertext`, all base64url,
 * with the version prefix so the scheme can change without a migration guessing
 * what it is looking at.
 *
 * The key comes from `FIELD_ENCRYPTION_KEY`. This is deliberately a separate key
 * from the auth secrets: it protects data at rest, and rotating a session secret
 * should never make stored PANs unreadable.
 */

const SCHEME = 'v1';
const ALGORITHM = 'aes-256-gcm';

let cachedKey: Buffer | null = null;

const key = (): Buffer => {
  if (cachedKey) return cachedKey;

  const configured = process.env.FIELD_ENCRYPTION_KEY;
  if (!configured) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY is not set. It is required before any credit or identity field can be stored.'
    );
  }

  /** Accepts a 32-byte key as base64 or hex; anything else is a configuration mistake. */
  const decoded = /^[0-9a-fA-F]{64}$/.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64');

  if (decoded.length !== 32) {
    throw new Error('FIELD_ENCRYPTION_KEY must decode to 32 bytes (256 bits)');
  }

  cachedKey = decoded;
  return cachedKey;
};

/** True for a value this module produced, so callers can tell stored forms apart. */
export const isEncrypted = (value: unknown): boolean =>
  typeof value === 'string' && value.startsWith(`${SCHEME}:`);

export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [SCHEME, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decryptField(stored: string): string {
  if (!isEncrypted(stored)) {
    throw new Error('Value is not in the stored encrypted form');
  }

  const [, ivPart, tagPart, dataPart] = stored.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
}

/**
 * What a PAN looks like on screen: `ABCDE1234F` becomes `XXXXX234F`.
 *
 * Enough for someone to recognise which card they entered, not enough to reuse.
 * Everything that returns a co-applicant to a browser masks it this way; the
 * full value leaves the server only on its way to the bureau.
 */
export const maskPan = (pan: string): string => {
  const trimmed = (pan || '').trim().toUpperCase();
  if (trimmed.length < 4) return '';
  return `${'X'.repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-4)}`;
};

/** The shape the income-tax department issues: five letters, four digits, a letter. */
export const isPanFormat = (pan: string): boolean => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((pan || '').trim().toUpperCase());

/**
 * The fourth character of a PAN says what kind of holder it is. `P` is an
 * individual — the only kind that can be a co-applicant on an education loan,
 * so a company PAN is caught here rather than by the bureau rejecting it later.
 */
export const isIndividualPan = (pan: string): boolean => (pan || '').trim().toUpperCase()[3] === 'P';
