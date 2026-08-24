import { BadRequestException, Injectable } from '@nestjs/common';
import { COUNTRIES, INDIA_CITIES } from '../reference/data/geo.data';
import {
  COMPETITIVE_EXAM_OPTIONS,
  CURRICULUM_OPTIONS,
  EDUCATION_GAP_OPTIONS,
  EDUCATION_YEARS,
  ENGLISH_EXAM_OPTIONS,
  EXAM_STATUS_OPTIONS,
  FIELDS_OF_STUDY,
  INTAKE_OPTIONS,
  START_YEARS,
  STUDY_COUNTRIES,
  UNIVERSITY_OPTIONS
} from '../reference/data/master-sheet.data';
import {
  CURRENCY_OPTIONS,
  EARNING_MEMBER_OPTIONS,
  EMPLOYMENT_CATEGORY_OPTIONS,
  EMPLOYMENT_TYPES,
  FUNDING_SOURCE_OPTIONS,
  QUALIFICATION_OPTIONS
} from '../reference/data/wizard.data';
import { FormFieldDef, FormSchemaDef, FormSectionDef } from './form-schema.types';
import { FormsService } from './forms.service';

/**
 * The option lists a schema may point at, so an admin picks "Countries" rather
 * than pasting 200 names — and so the same list validates the answer that
 * populated the dropdown.
 */
const OPTION_SOURCES: Record<string, readonly string[]> = {
  countries: COUNTRIES.map(country => country.name),
  dialCodes: COUNTRIES.map(country => country.iso2),
  indiaCities: INDIA_CITIES,
  studyCountries: STUDY_COUNTRIES,
  fieldsOfStudy: FIELDS_OF_STUDY,
  intakeOptions: INTAKE_OPTIONS,
  startYears: START_YEARS,
  qualificationOptions: QUALIFICATION_OPTIONS,
  curriculumOptions: CURRICULUM_OPTIONS,
  educationGapOptions: EDUCATION_GAP_OPTIONS,
  educationYears: EDUCATION_YEARS,
  universityOptions: UNIVERSITY_OPTIONS,
  englishExamOptions: ENGLISH_EXAM_OPTIONS,
  competitiveExamOptions: COMPETITIVE_EXAM_OPTIONS,
  examStatusOptions: EXAM_STATUS_OPTIONS,
  employmentTypes: EMPLOYMENT_TYPES,
  fundingSourceOptions: FUNDING_SOURCE_OPTIONS,
  earningMemberOptions: EARNING_MEMBER_OPTIONS,
  currencyOptions: CURRENCY_OPTIONS,
  employmentCategoryOptions: EMPLOYMENT_CATEGORY_OPTIONS
};

const isBlank = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

/**
 * Validates a section payload against the published schema.
 *
 * The same definition the student portal renders from decides what the API
 * accepts, so a field an admin adds is enforced without a code change and a
 * field they remove stops being demanded. Rules that are behaviour rather than
 * shape — which exam status needs which score, how household income is summed —
 * stay in the students service, because a field list cannot express them.
 */
@Injectable()
export class SchemaValidatorService {
  constructor(private forms: FormsService) {}

  async sectionFor(sectionKey: string, variant = 'DEFAULT'): Promise<FormSectionDef | undefined> {
    const schema: FormSchemaDef = await this.forms.published(variant);
    return schema.sections.find(section => section.key === sectionKey);
  }

  /** Options a field accepts, whether listed inline or borrowed from reference data. */
  optionsFor(field: FormFieldDef): readonly string[] | undefined {
    if (field.optionsSource?.startsWith('reference:')) {
      return OPTION_SOURCES[field.optionsSource.slice('reference:'.length)];
    }
    return field.options?.length ? field.options : undefined;
  }

  /**
   * Restores the fields an admin added and then validates the result.
   *
   * The global pipe whitelists a payload down to its DTO, which would discard
   * any field the schema added. The raw body still carries them, so they are
   * merged back — but only the ones the published schema actually declares, so
   * this widens the payload to the admin's form rather than to anything a client
   * cares to send.
   */
  async mergeAndValidate(
    sectionKey: string,
    validated: Record<string, unknown>,
    rawBody: Record<string, unknown>,
    variant = 'DEFAULT'
  ) {
    const section = await this.sectionFor(sectionKey, variant);
    const merged: Record<string, unknown> = { ...validated };

    if (section && rawBody) {
      for (const field of section.fields) {
        if (!field.enabled) continue;

        /**
         * A repeating block is validated by a DTO that knows only the coded row
         * keys, so the pipe strips anything an admin added inside a row. Each row
         * gets those keys put back from the raw body before it is checked.
         */
        if (field.composite) {
          merged[field.key] = this.mergeRows(field, merged[field.key], rawBody[field.key]);
          continue;
        }

        if (merged[field.key] === undefined && rawBody[field.key] !== undefined) {
          merged[field.key] = rawBody[field.key];
        }
      }
    }

    await this.validate(sectionKey, merged, variant);
    return merged;
  }

  /**
   * Throws a `VALIDATION_ERROR` listing everything wrong, in the same shape the
   * class-validator DTOs produced, so existing clients see no difference.
   */
  async validate(sectionKey: string, payload: Record<string, unknown>, variant = 'DEFAULT') {
    const section = await this.sectionFor(sectionKey, variant);
    /** No schema for this section means nothing to enforce beyond the code rules. */
    if (!section) return payload;

    const errors: string[] = [];

    for (const field of section.fields) {
      if (!field.enabled) continue;
      /** A field hidden by its own condition is neither required nor checked. */
      if (!this.isVisible(field, payload)) continue;
      if (field.composite) {
        if (field.required && isBlank(payload[field.key])) {
          errors.push(`${field.label} is required`);
          continue;
        }
        /** Each row is checked against the row definition an admin can edit. */
        errors.push(...this.checkRows(field, payload[field.key]));
        continue;
      }

      const value = payload[field.key];

      if (isBlank(value)) {
        if (field.required) errors.push(`${field.label} is required`);
        continue;
      }

      errors.push(...this.checkValue(field, value));
    }

    if (errors.length) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: errors });
    }
    return payload;
  }

  /**
   * Restores the row values the validation pipe stripped.
   *
   * Rows are matched by position, which is how they arrived; a row the pipe
   * dropped entirely is taken from the raw body wholesale.
   */
  private mergeRows(field: FormFieldDef, validated: unknown, raw: unknown): unknown {
    const declared = (field.itemFields || []).filter(rowField => rowField.enabled).map(rowField => rowField.key);
    if (!declared.length || !Array.isArray(raw)) return validated ?? raw;

    const rows = Array.isArray(validated) ? validated : [];
    return raw.map((rawRow, index) => {
      const kept = rows[index];
      if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) return kept ?? rawRow;

      const source = rawRow as Record<string, unknown>;
      const target: Record<string, unknown> = { ...((kept as Record<string, unknown>) || {}) };
      for (const key of declared) {
        if (target[key] === undefined && source[key] !== undefined) target[key] = source[key];
      }
      return target;
    });
  }

  /**
   * Every row of a composite, against the fields that row declares.
   *
   * A row's own values decide what it must carry — an academic row keyed on its
   * level, an exam row on its status — so each is checked in its own right
   * rather than against the section around it.
   */
  private checkRows(field: FormFieldDef, value: unknown): string[] {
    const rows = field.itemFields || [];
    if (!rows.length || isBlank(value)) return [];
    if (!Array.isArray(value)) return [];

    const errors: string[] = [];
    value.forEach((entry, index) => {
      /** A row that is not an object carries a single value; nothing to check per field. */
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      const row = entry as Record<string, unknown>;
      /** A label a person can act on: "Roles #2 — Company is required". */
      const where = `${field.label} #${index + 1}`;

      for (const rowField of rows) {
        if (!rowField.enabled) continue;
        if (!this.isVisible(rowField, row)) continue;

        const cell = row[rowField.key];
        if (isBlank(cell)) {
          if (rowField.required) errors.push(`${where} — ${rowField.label} is required`);
          continue;
        }
        errors.push(...this.checkValue(rowField, cell).map(problem => `${where} — ${problem}`));
      }
    });
    return errors;
  }

  /** Whether a field's `visibleWhen` condition is satisfied by the payload. */
  isVisible(field: FormFieldDef, payload: Record<string, unknown>): boolean {
    if (!field.visibleWhen) return true;
    const actual = payload[field.visibleWhen.field];
    const wanted = field.visibleWhen.equals || [];
    if (!wanted.length) return true;
    if (Array.isArray(actual)) return actual.some(entry => wanted.includes(String(entry)));
    return wanted.includes(String(actual ?? ''));
  }

  private checkValue(field: FormFieldDef, value: unknown): string[] {
    const errors: string[] = [];
    const options = this.optionsFor(field);

    if (field.type === 'multiselect') {
      if (!Array.isArray(value)) return [`${field.label} must be a list`];
      if (options) {
        const unknown = value.filter(entry => !options.includes(String(entry)));
        if (unknown.length) errors.push(`${field.label} has unrecognised values: ${unknown.join(', ')}`);
      }
      return errors;
    }

    if (field.type === 'checkbox') {
      if (typeof value !== 'boolean') errors.push(`${field.label} must be true or false`);
      else if (field.required && !value) errors.push(`${field.label} must be accepted`);
      return errors;
    }

    if (field.type === 'select') {
      if (options && !options.includes(String(value))) {
        errors.push(`${field.label} must be one of the available options`);
      }
      return errors;
    }

    if (field.type === 'number') {
      const numeric = Number(String(value).replace(/,/g, ''));
      if (Number.isNaN(numeric)) return [`${field.label} must be a number`];
      if (field.validation?.min !== undefined && numeric < field.validation.min) {
        errors.push(`${field.label} must be at least ${field.validation.min}`);
      }
      if (field.validation?.max !== undefined && numeric > field.validation.max) {
        errors.push(`${field.label} must be at most ${field.validation.max}`);
      }
      return errors;
    }

    /** Everything else is text-shaped. */
    const text = String(value);
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      errors.push(`${field.label} must be a valid email address`);
    }
    if (field.validation?.minLength !== undefined && text.length < field.validation.minLength) {
      errors.push(`${field.label} must be at least ${field.validation.minLength} characters`);
    }
    if (field.validation?.maxLength !== undefined && text.length > field.validation.maxLength) {
      errors.push(`${field.label} must be at most ${field.validation.maxLength} characters`);
    }
    if (field.validation?.pattern) {
      let expression: RegExp | undefined;
      try {
        expression = new RegExp(field.validation.pattern);
      } catch {
        /** A pattern that no longer compiles is treated as absent rather than
         *  rejecting every answer; the builder refuses to save one. */
      }
      if (expression && !expression.test(text)) {
        errors.push(field.validation.message || `${field.label} is not in the expected format`);
      }
    }
    if (options && !options.includes(text)) {
      errors.push(`${field.label} must be one of the available options`);
    }

    return errors;
  }
}
