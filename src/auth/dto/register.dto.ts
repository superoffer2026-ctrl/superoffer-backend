import { Type } from 'class-transformer';
import {
  IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf, ValidateNested
} from 'class-validator';
import {
  PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_PATTERN, PASSWORD_REQUIREMENTS_MESSAGE
} from '../password.util';

const WEBSITE_PATTERN = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;

const isStudentRole = (dto: { role?: string }) => dto.role === 'STUDENT';

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
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_REQUIREMENTS_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_REQUIREMENTS_MESSAGE })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_REQUIREMENTS_MESSAGE })
  password!: string;

  @ValidateIf(isStudentRole)
  @IsString()
  @IsNotEmpty({ message: 'Enter your full name' })
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @IsNotEmpty()
  role!: string;

  @ValidateIf(dto => !isStudentRole(dto))
  @IsNotEmpty({ message: 'Organisation details are required' })
  @ValidateNested()
  @Type(() => OrganizationRegistrationDto)
  organization?: OrganizationRegistrationDto;
}
