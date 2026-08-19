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
