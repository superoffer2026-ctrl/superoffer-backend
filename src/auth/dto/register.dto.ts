import { Type } from 'class-transformer';
import {
  IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength, ValidateIf, ValidateNested
} from 'class-validator';

const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

/** A hostname, with or without a scheme — enough to check a domain against. */
const WEBSITE_PATTERN = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;

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
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(PASSWORD_PATTERN, { message: 'Password must contain at least one letter and one number' })
  password!: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @IsNotEmpty()
  role!: string;

  /** Required for institution roles; students have no organization. */
  @ValidateIf(o => o.role !== 'STUDENT')
  @IsNotEmpty({ message: 'Organisation details are required' })
  @ValidateNested()
  @Type(() => OrganizationRegistrationDto)
  organization?: OrganizationRegistrationDto;
}
