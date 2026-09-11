/**
 * One password rule, in one place.
 *
 * The register, password-reset and change-password paths all validate against
 * this, so a password that can be set in one place can be set in all of them.
 * Mirrored for live feedback by the frontend's `lib/auth/password-rules.ts` —
 * change one and change the other.
 */

/** bcrypt silently ignores anything past 72 bytes, so the cap sits safely below it. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;

export const PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,64}$/;

export const PASSWORD_REQUIREMENTS_MESSAGE =
  'Password must be 8-64 characters and include an uppercase letter, a lowercase letter, a number and a special character';
