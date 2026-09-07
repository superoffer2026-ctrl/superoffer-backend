import * as crypto from 'node:crypto';

export const generateOtpCode = (): string => String(crypto.randomInt(100_000, 1_000_000));

export const hashOtp = (code: string, secret: string): string =>
  crypto.createHmac('sha256', secret).update(code).digest('base64url');

export const verifyOtpHash = (code: string, storedHash: string, secret: string): boolean => {
  const expected = Buffer.from(hashOtp(code, secret));
  const actual = Buffer.from(storedHash || '');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Constant-time check of a presented token against a stored `hashToken` digest.
 *
 * An absent hash never matches: a session row is created with an empty
 * `refreshTokenHash` and patched a moment later (see AuthService.issueTokens),
 * and that window must not be a way in.
 */
export const verifyTokenHash = (token: string, storedHash: string): boolean => {
  if (!storedHash) return false;
  const expected = Buffer.from(hashToken(token));
  const actual = Buffer.from(storedHash);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};
