import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min
} from 'class-validator';

export const OFFER_CATEGORIES = ['UNIVERSITY', 'BANK', 'SCHOLARSHIP', 'CONSULTANCY'] as const;

export class CreateOfferDto {
  /** The template this offer went out on, when it came from one. */
  @IsOptional() @IsString()
  templateId?: string;

  @IsString() @IsNotEmpty()
  studentUserId!: string;

  /**
   * The programme this offer is for. What makes "select a programme" fill the
   * offer in rather than the officer retyping a prospectus every time.
   */
  @IsOptional() @IsString()
  productId?: string;

  /** Defaults to the sending organization's own category when omitted. */
  @IsOptional() @IsIn(OFFER_CATEGORIES)
  category?: string;

  @IsString() @IsNotEmpty()
  program!: string;

  @IsString() @IsNotEmpty()
  headline!: string;

  /** The template's own description, distinct from `conditions` (the terms a student must meet). */
  @IsOptional() @IsString()
  description?: string;

  /**
   * Category-specific figures the comparison table renders — `tuitionFee`,
   * `scholarshipPct`, `durationYears` for universities; `loanAmount`,
   * `interestRate`, `emi`, `moratorium`, `processingFee`, `tenure` for banks.
   */
  @IsOptional() @IsObject()
  terms?: Record<string, unknown>;

  @IsOptional() @IsString()
  conditions?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  nextSteps?: string[];

  @IsOptional() @IsString()
  contactName?: string;

  @IsOptional() @IsString()
  contactRole?: string;

  @IsOptional() @IsString()
  location?: string;

  @IsOptional() @IsString()
  intake?: string;

  @IsOptional() @IsString()
  valueLabel?: string;

  @IsOptional() @IsString()
  value?: string;

  /** Defaults to the standard 14-day window when omitted. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(180)
  responseWindowDays?: number;
}

export class OfferDecisionDto {
  @IsIn(['Pending', 'Shortlisted', 'Accepted', 'Rejected'])
  status!: string;
}

export class OfferFlagsDto {
  @IsOptional() @IsBoolean()
  saved?: boolean;

  @IsOptional() @IsBoolean()
  favourite?: boolean;

  @IsOptional() @IsBoolean()
  compared?: boolean;
}

export class OfferMessageDto {
  @IsString() @IsNotEmpty()
  body!: string;
}
