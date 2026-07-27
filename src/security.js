import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

const base64Url = value => Buffer.from(value).toString('base64url');

export const hashPassword = async password => {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString('base64url')}:${derivedKey.toString('base64url')}`;
};

export const verifyPassword = async (password, storedHash) => {
  const [algorithm, saltValue, hashValue] = String(storedHash).split(':');
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;

  const expected = Buffer.from(hashValue, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

export const createToken = (claims, { secret, expiresInSeconds, type }) => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    ...claims,
    type,
    iat: issuedAt,
    exp: issuedAt + expiresInSeconds,
    jti: crypto.randomUUID()
  }));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
};
