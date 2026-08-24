import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested
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

export class ProductDto {
  @IsString() @IsNotEmpty()
  name!: string;

  @IsOptional() @IsIn(PRODUCT_CATEGORIES)
  category?: string;

  @IsOptional() @IsString()
  url?: string;

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
