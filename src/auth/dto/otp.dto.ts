import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { MOBILE_DIGITS_PATTERN, toMobileDigits } from '../phone.util';
import {
  PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_PATTERN, PASSWORD_REQUIREMENTS_MESSAGE
} from '../password.util';

/**
 * The two moments a student is sent a code. `REGISTER` confirms a number at
 * signup and signs them in; `PASSWORD_RESET` only unlocks the form where they
 * choose a new password — it never issues a session of its own.
 */
export const OTP_PURPOSES = ['REGISTER', 'PASSWORD_RESET'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export class OtpRequestDto {
  @Transform(({ value }) => toMobileDigits(value))
  @IsString()
  @IsNotEmpty({ message: 'Enter your WhatsApp number' })
  @Matches(MOBILE_DIGITS_PATTERN, { message: 'Enter the 10-digit WhatsApp number that follows +91' })
  phone!: string;

  @IsOptional()
  @IsIn(OTP_PURPOSES)
  purpose?: OtpPurpose;
}

export class OtpVerifyDto {
  @Transform(({ value }) => toMobileDigits(value))
  @IsString()
  @IsNotEmpty({ message: 'Enter your WhatsApp number' })
  @Matches(MOBILE_DIGITS_PATTERN, { message: 'Enter the 10-digit WhatsApp number that follows +91' })
  phone!: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter the code sent to your WhatsApp' })
  code!: string;

  @IsOptional()
  @IsIn(OTP_PURPOSES)
  purpose?: OtpPurpose;
}

/** Completes a forgotten-password reset, using the token handed back by OTP verification. */
export class PasswordResetDto {
  @IsString()
  @IsNotEmpty()
  resetToken!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_REQUIREMENTS_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_REQUIREMENTS_MESSAGE })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_REQUIREMENTS_MESSAGE })
  password!: string;
}
