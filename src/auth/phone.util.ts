/**
 * A student's WhatsApp number is their identity: the sign-in identifier, and
 * where every OTP is delivered. SuperOffer's students are in India, so the form
 * fixes the +91 dial code and asks only for the 10 national digits — every
 * student number is stored in the one canonical shape `+91XXXXXXXXXX`.
 *
 * Institutions are a different case: a university officer may be anywhere, so
 * their optional contact number keeps the general international check.
 */

/** E.164 without the leading zero: a country code that can't start with 0, then 7-14 more digits. */
export const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/;

export const INDIA_DIAL_CODE = '+91';

/** Exactly the ten digits typed after the fixed +91. */
export const MOBILE_DIGITS_PATTERN = /^\d{10}$/;

export const normalizePhone = (phone: unknown): string =>
  String(phone ?? '').trim().replace(/[\s()-]/g, '');

export const isValidPhone = (phone: unknown): boolean => PHONE_PATTERN.test(normalizePhone(phone));

/**
 * Reduces anything a student might type — `9876543210`, `+91 98765-43210`,
 * `919876543210`, `09876543210` — to the ten national digits, so the same
 * person is the same account however they enter it.
 */
export const toMobileDigits = (input: unknown): string => {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
};

/** The canonical stored form, or `''` when the input is not ten digits. */
export const normalizeStudentPhone = (input: unknown): string => {
  const digits = toMobileDigits(input);
  return MOBILE_DIGITS_PATTERN.test(digits) ? `${INDIA_DIAL_CODE}${digits}` : '';
};
