import { Transform, Type } from 'class-transformer';
import {
  IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength, Validate,
  ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface, ValidateIf, ValidateNested
} from 'class-validator';
import { MOBILE_DIGITS_PATTERN, normalizePhone, PHONE_PATTERN, toMobileDigits } from '../phone.util';
import {
  PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_PATTERN, PASSWORD_REQUIREMENTS_MESSAGE
} from '../password.util';

/** A hostname, with or without a scheme — enough to check a domain against. */
const WEBSITE_PATTERN = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;

const isStudentRole = (dto: { role?: string }) => dto.role === 'STUDENT';

/**
 * The number means different things either side of the marketplace, so one
 * property cannot be described by stacked decorators — `@ValidateIf` applies its
 * condition to every validator on a property, not to the one beneath it.
 *
 * A student's is their identity: ten digits behind the fixed +91, and required.
 * An institution officer's is an optional contact detail and may be anywhere in
 * the world, so it keeps the general international check.
 */
@ValidatorConstraint({ name: 'phoneForRole' })
class PhoneForRole implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    if (isStudentRole(args.object as RegisterDto)) {
      return MOBILE_DIGITS_PATTERN.test(String(value ?? ''));
    }
    return !value || PHONE_PATTERN.test(normalizePhone(value));
  }

  defaultMessage(args: ValidationArguments) {
    return isStudentRole(args.object as RegisterDto)
      ? 'Enter the 10-digit WhatsApp number that follows +91'
      : 'Enter a valid phone number, for example +14165550001';
  }
}

/**
 * Creating an account, not proving who you are.
 *
 * The evidence an approval rests on is asked for after signing in, on the
 * verification page, where a registrar can gather certificates at their own
 * pace and see exactly what is still outstanding. Demanding it at the signup
 * form turned one missing licence number into a wall of red and an abandoned
 * registration — and nothing is at risk in the meantime, because an
 * unapproved organisation cannot see a single student.
 */
export class OrganizationRegistrationDto {
  @IsString()
  @IsNotEmpty({ message: 'Enter the organisation legal name' })
  name!: string;

  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  licenseReference?: string;

  @IsOptional()
  @IsString()
  @Matches(WEBSITE_PATTERN, { message: 'Enter a valid website, for example www.example.edu' })
  website?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  city?: string;
}

export class RegisterDto {
  /**
   * Institutions and admins sign in with email. Students have none at all: they
   * are identified by the WhatsApp number that receives their OTP, so the
   * student signup form never asks for an address and never stores one.
   */
  @ValidateIf(dto => !isStudentRole(dto))
  @IsEmail({}, { message: 'Enter a valid email address' })
  email?: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_REQUIREMENTS_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_REQUIREMENTS_MESSAGE })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_REQUIREMENTS_MESSAGE })
  password!: string;

  @ValidateIf(isStudentRole)
  @IsString()
  @IsNotEmpty({ message: 'Enter your full name' })
  fullName?: string;

  /**
   * Reduced to its canonical shape before validation, so `9876543210`,
   * `+91 98765-43210` and `919876543210` are all the same student.
   */
  @Transform(({ value, obj }) => (isStudentRole(obj) ? toMobileDigits(value) : normalizePhone(value)))
  @Validate(PhoneForRole)
  phone?: string;

  @IsString()
  @IsNotEmpty()
  role!: string;

  /** Required for institution roles; students have no organization. */
  @ValidateIf(dto => !isStudentRole(dto))
  @IsNotEmpty({ message: 'Organisation details are required' })
  @ValidateNested()
  @Type(() => OrganizationRegistrationDto)
  organization?: OrganizationRegistrationDto;
}
