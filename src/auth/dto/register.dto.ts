import { Type } from 'class-transformer';
import {
  IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength, ValidateIf, ValidateNested
} from 'class-validator';

const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

/** A hostname, with or without a scheme — enough to check a domain against. */
const WEBSITE_PATTERN = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;

/**
 * What an approval rests on.
 *
 * An approved organisation can read submitted student profiles — names, marks,
 * budgets, and for lenders the co-applicant's financial details. So approval is
 * the gate on real people's data, and the reviewer is told to confirm these
 * references against the issuing authority. Optional fields made that
 * instruction unfollowable: the queue arrived carrying "Not provided".
 */
export class OrganizationRegistrationDto {
  @IsString()
  @IsNotEmpty({ message: 'Enter the organisation legal name' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter the registration number the authority issued' })
  registrationNumber!: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter the accreditation or licence reference' })
  licenseReference!: string;

  /** The official site is how a reviewer checks the email domain is really theirs. */
  @IsString()
  @IsNotEmpty({ message: 'Enter the official website' })
  @Matches(WEBSITE_PATTERN, { message: 'Enter a valid website, for example www.example.edu' })
  website!: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter the country' })
  country!: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter the city' })
  city!: string;
}

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(PASSWORD_PATTERN, { message: 'Password must contain at least one letter and one number' })
  password!: string;

  /** A student may be nameless for a moment; an organisation has a named contact. */
  @ValidateIf(o => o.role !== 'STUDENT')
  @IsString()
  @IsNotEmpty({ message: 'Enter the name of the person we should contact' })
  fullName?: string;

  @ValidateIf(o => o.role !== 'STUDENT')
  @IsString()
  @IsNotEmpty({ message: 'Enter a contact phone number' })
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
