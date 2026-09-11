import { Type } from 'class-transformer';
import {
  ArrayNotEmpty, IsArray, IsEmail, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Max, Min, ValidateNested
} from 'class-validator';

export const SUBSCRIPTION_PLANS = ['Basic', 'Professional', 'Enterprise'] as const;
export const BANK_EVALUATION_MODES = ['ACADEMIC_ONLY', 'UNIVERSITY_OFFER_ONLY', 'ACADEMIC_AND_OFFER'] as const;
export const PRODUCT_CATEGORIES = ['Academic Product', 'Financial Product'] as const;

export class OrganizationProfileDto {
  @IsOptional() @IsString() @IsNotEmpty()
  name?: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  city?: string;

  /** The workspace calls this "official domain". */
  @IsOptional() @IsString()
  website?: string;

  @IsOptional() @IsIn(SUBSCRIPTION_PLANS)
  plan?: string;

  @IsOptional() @IsIn(BANK_EVALUATION_MODES)
  bankEvaluationMode?: string;

  /** Matching thresholds; shape differs by organization type. */
  @IsOptional() @IsObject()
  criteria?: Record<string, unknown>;

  @IsOptional() @IsArray()
  notificationPrefs?: unknown[];

  /** Reusable offer term sets shown in the composer. */
  @IsOptional() @IsArray()
  offerTemplates?: unknown[];
}

export const DEGREE_LEVELS = ["Bachelor's", "Master's", 'PhD', 'Diploma', 'Certificate'];
export const STUDY_MODES = ['On campus', 'Online', 'Hybrid'];

/**
 * A programme, or a lender's product.
 *
 * Everything academic is optional because this one shape serves both sides of
 * the marketplace — a loan product has no intake and no degree level. What a
 * university fills in is what a student is later shown, so these are real
 * columns rather than another key in the free-form `terms`.
 */
export class ProductDto {
  @IsString() @IsNotEmpty()
  name!: string;

  @IsOptional() @IsIn(PRODUCT_CATEGORIES)
  category?: string;

  @IsOptional() @IsString()
  url?: string;

  @IsOptional() @IsIn(DEGREE_LEVELS)
  degreeLevel?: string;

  @IsOptional() @IsString()
  fieldOfStudy?: string;

  @IsOptional() @IsInt() @Min(1) @Max(120)
  durationMonths?: number;

  @IsOptional() @IsIn(STUDY_MODES)
  studyMode?: string;

  @IsOptional() @IsString()
  campusLocation?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  intakes?: string[];

  /** Whole units in, minor units stored — the service converts. */
  @IsOptional() @IsNumber() @Min(0)
  tuitionFee?: number;

  @IsOptional() @IsString()
  currency?: string;

  @IsOptional() @IsString()
  scholarshipInfo?: string;

  @IsOptional() @IsObject()
  terms?: Record<string, unknown>;
}

export class ImportProductsDto {
  @IsArray() @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ProductDto)
  products!: ProductDto[];
}

export const SHORTLIST_STATUSES = ['SHORTLISTED', 'REJECTED'] as const;

export class ShortlistDto {
  @IsString() @IsNotEmpty()
  studentUserId!: string;

  @IsOptional() @IsIn(SHORTLIST_STATUSES)
  status?: string;
}

export class TeamInviteDto {
  @IsString() @IsNotEmpty()
  name!: string;

  @IsEmail()
  email!: string;
}
