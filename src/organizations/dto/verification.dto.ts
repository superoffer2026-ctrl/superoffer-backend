import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

/** A hostname, with or without a scheme — enough to check a domain against. */
const WEBSITE_PATTERN = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;

/**
 * The evidence a reviewer checks against the issuing authority.
 *
 * Every field is optional here on purpose: this is a page an organisation
 * returns to, so a half-finished submission has to save. What is *required*
 * is decided when they ask to be reviewed, where the missing pieces can be
 * named one by one rather than rejected as a block.
 */
export class OrganizationVerificationDto {
  @IsOptional() @IsString()
  registrationNumber?: string;

  @IsOptional() @IsString()
  licenseReference?: string;

  @IsOptional()
  @IsString()
  @Matches(WEBSITE_PATTERN, { message: 'Enter a valid website, for example www.example.edu' })
  website?: string;

  @IsOptional() @IsString()
  country?: string;

  @IsOptional() @IsString()
  city?: string;

  @IsOptional() @IsString()
  description?: string;

  /**
   * Set when the organisation says it is ready to be looked at.
   *
   * Needs a type decorator, not just @IsOptional: the pipe whitelists on
   * validation metadata, so a field with none is silently dropped.
   */
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}
