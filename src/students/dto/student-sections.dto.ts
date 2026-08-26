import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested
} from 'class-validator';
import { COUNTRY_NAMES } from '../../reference/data/geo.data';
import {
  CURRICULUM_OPTIONS,
  EDUCATION_GAP_OPTIONS,
  EXAM_STATUS_OPTIONS,
  INTAKE_OPTIONS,
  START_YEARS,
  STUDY_COUNTRIES
} from '../../reference/data/master-sheet.data';
import {
  CURRENCY_OPTIONS,
  EARNING_MEMBER_OPTIONS,
  EMPLOYMENT_CATEGORY_OPTIONS,
  EMPLOYMENT_TYPES,
  FUNDING_SOURCE_OPTIONS,
  QUALIFICATION_OPTIONS
} from '../../reference/data/wizard.data';

/**
 * One DTO per wizard section, each validated against the same constants the
 * `/reference/*` endpoints serve — so a student can never be offered an option the
 * server then rejects (docs/08-Reference-Data.md).
 *
 * These carry *shape*: is it a string, is it one of the known options, is the
 * nested structure right. They deliberately do not decide whether a field is
 * required — that belongs to the published form schema, which an admin controls,
 * and is enforced by SchemaValidatorService before these run. A field the admin
 * removes must stop being demanded, which a compiled `@IsNotEmpty` could never do.
 *
 * Free-text fields the UI lets the student type (university name, project titles,
 * achievements) are deliberately not constrained to a list.
 */

// ── Step 1 · Personal information ────────────────────────────────────────────

/**
 * Membership in an option list is not decided here.
 *
 * These lists are editable by an admin at runtime, and a decorator captures its
 * array when the class is defined — so an option added this morning would render
 * in the dropdown and be rejected on save, with nothing in the message to
 * explain why. The published form is the single gate: SchemaValidatorService
 * reads the current list, and widens it with whatever this student already
 * holds so removing an option never invalidates a profile that predates it.
 *
 * The shape is still enforced here. Only the membership moved.
 */
export class PersonalInformationDto {
  @IsOptional() @IsString()
  fullName?: string;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsString()
  mobileCountry?: string;

  @IsOptional() @IsString()
  mobileNumber?: string;

  @IsOptional() @IsString()
  altMobileCountry?: string;

  @IsOptional() @IsString()
  altMobileNumber?: string;

  /** Matched by exact name against the /reference/geo list. */
  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional() @IsString()
  city?: string;

  /** Derived client-side from dial code + number; stored as sent so the UI can render it back. */
  @IsOptional() @IsString()
  phone?: string;

  @IsOptional() @IsString()
  location?: string;
}

// ── Step 2 · Study preferences ───────────────────────────────────────────────

/**
 * Shape and allowed values, not presence.
 *
 * Whether a field is required is the published form's call — an admin who hides
 * or relaxes one must not be overruled here — so every field is optional to the
 * DTO and the schema validator decides what must actually be answered.
 */
export class StudyPreferencesDto {
  @IsOptional() @IsArray()
  @IsString({ each: true })
  countries?: string[];

  /** "What do you want to study?" — a subject list, not the StudyLevel enum. */
  @IsOptional() @IsArray()
  @IsString({ each: true })
  studyLevel?: string[];

  /** "Program of Interest". */
  @IsOptional() @IsArray()
  @IsString({ each: true })
  fieldOfInterest?: string[];

  @IsOptional() @IsArray()
  @IsString({ each: true })
  startYear?: string[];

  @IsOptional() @IsArray()
  @IsString({ each: true })
  intake?: string[];
}

// ── Step 3 · Academic information ────────────────────────────────────────────

export class AcademicHistoryEntryDto {
  @IsString()
  level!: string;

  @IsOptional() @IsString()
  curriculum?: string;

  @IsOptional() @IsString()
  degreeName?: string;

  @IsOptional() @IsString()
  specialization?: string;

  /** A select that also allows custom values — never reject an unlisted institution. */
  @IsOptional() @IsString()
  institutionName?: string;

  @IsOptional() @IsString()
  cgpa?: string;

  @IsOptional() @IsString()
  backlogs?: string;

  @IsOptional() @IsString()
  startedYear?: string;

  @IsOptional() @IsString()
  completionYear?: string;

  @IsOptional() @IsString()
  yearsOfEducation?: string;
}

export class AcademicInformationDto {
  @IsString()
  qualificationLevel!: string;

  @IsOptional() @IsString()
  institution?: string;

  @IsOptional() @IsString()
  score?: string;

  @IsOptional() @IsString()
  graduationYear?: string;

  @IsOptional() @IsString()
  qualification?: string;

  @IsOptional() @IsString()
  educationGap?: string;

  @IsArray() @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AcademicHistoryEntryDto)
  history!: AcademicHistoryEntryDto[];
}

// ── Steps 4 & 5 · Entrance exams ─────────────────────────────────────────────

export class ExamEntryDto {
  @IsString() @IsNotEmpty()
  exam!: string;

  @IsString()
  status!: string;

  @IsOptional() @IsString()
  score?: string;

  @IsOptional() @IsString()
  expectedScore?: string;

  @IsOptional() @IsString()
  currentScore?: string;
}

export class EnglishExamDto {
  /** Whether the student has any exam to declare at all. */
  @IsOptional() @IsString()
  attended?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamEntryDto)
  englishExams!: ExamEntryDto[];

  /** Flattened first entry, kept for the organization-side search projection. */
  @IsOptional() @IsString()
  englishExam?: string;

  @IsOptional() @IsString()
  englishScore?: string;
}

export class CompetitiveExamDto {
  /** Whether the student has any exam to declare at all. */
  @IsOptional() @IsString()
  attended?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamEntryDto)
  competitiveExams!: ExamEntryDto[];

  @IsOptional() @IsString()
  entranceExam?: string;

  @IsOptional() @IsString()
  entranceScore?: string;
}

// ── Step 6 · Work experience ─────────────────────────────────────────────────

export class ExperienceEntryDto {
  @IsString() @IsNotEmpty()
  companyName!: string;

  @IsString() @IsNotEmpty()
  role!: string;

  @IsString()
  type!: string;

  @IsString() @IsNotEmpty()
  durationMonths!: string;

  @IsOptional() @IsString()
  description?: string;
}

export class WorkExperienceDto {
  /** 'Fresher' or 'Yes' — the years and entries below only apply to 'Yes'. */
  @IsOptional() @IsIn(['Fresher', 'Yes'])
  workStatus?: string;

  @IsOptional() @IsString()
  relevantYears?: string;

  @IsOptional() @IsString()
  nonRelevantYears?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExperienceEntryDto)
  experiences!: ExperienceEntryDto[];

  @IsOptional() @IsString()
  companyName?: string;

  @IsOptional() @IsString()
  jobRole?: string;
}

// ── Step 7 · Financial information ───────────────────────────────────────────

export class FinancialInformationDto {
  @IsString()
  fundingSource!: string;

  @IsArray() @ArrayNotEmpty()
  @IsString({ each: true })
  earningMembers!: string[];

  @IsOptional() @IsString()
  fatherIncome?: string;

  @IsOptional() @IsString()
  motherIncome?: string;

  @IsOptional() @IsString()
  guardianIncome?: string;

  /** Computed client-side as the sum of the selected earners; recomputed server-side on save. */
  @IsOptional() @IsString()
  annualHouseholdIncome?: string;

  @IsString()
  currency!: string;

  @IsString()
  employmentCategory!: string;

  @IsIn(['yes', 'no'])
  needsLoan!: string;

  @IsBoolean()
  declarationAccurate!: boolean;

  @IsBoolean()
  declarationConsent!: boolean;
}

// ── Step 8 · Projects & achievements ─────────────────────────────────────────

export class ProjectEntryDto {
  @IsString() @IsNotEmpty()
  title!: string;

  @IsString() @IsNotEmpty()
  role!: string;

  @IsOptional() @IsString()
  description?: string;
}

export class ProjectsAchievementsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectEntryDto)
  projects!: ProjectEntryDto[];

  @IsArray()
  @IsString({ each: true })
  achievements!: string[];

  @IsArray()
  @IsString({ each: true })
  links!: string[];

  @IsOptional() @IsString()
  githubLink?: string;

  @IsOptional() @IsString()
  linkedinLink?: string;

  @IsOptional() @IsString()
  projectTitle?: string;

  @IsOptional() @IsString()
  projectRole?: string;
}
