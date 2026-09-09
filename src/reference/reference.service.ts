import { Injectable } from '@nestjs/common';
import { OptionSetsService } from '../forms/option-sets.service';
import { CITIES_BY_STATE, COUNTRIES, INDIA_CITIES, INDIA_STATES } from './data/geo.data';
import {
  BANK_EVALUATION_MODE_OPTIONS,
  OFFER_CONDITION_PRESETS,
  SUBSCRIPTION_PLAN_OPTIONS
} from './data/organization.data';
import {
  COMPETITIVE_EXAM_OPTIONS,
  CURRICULUM_OPTIONS,
  EDUCATION_GAP_OPTIONS,
  EDUCATION_YEARS,
  ENGLISH_EXAM_OPTIONS,
  EXAM_STATUS_OPTIONS,
  FIELDS_OF_STUDY,
  INTAKE_OPTIONS,
  MBBS_ONLY_COUNTRIES,
  PROGRAM_LEVELS,
  START_YEARS,
  STUDY_COUNTRIES,
  UNIVERSITY_OPTIONS
} from './data/master-sheet.data';
import {
  ACHIEVEMENT_SUGGESTIONS,
  CURRENCY_OPTIONS,
  EARNING_MEMBER_OPTIONS,
  EMPLOYMENT_TYPES,
  FINANCIAL_DOCUMENT_FIELDS,
  FUNDING_SOURCE_OPTIONS,
  PROFILE_DOCUMENT_TYPES,
  QUALIFICATION_OPTIONS
} from './data/wizard.data';

/**
 * Serves every dropdown in the student wizard.
 *
 * The lists come from the option-set store, falling back to the constant they
 * were seeded from. That fallback matters: this endpoint answers before the
 * store has loaded on a cold boot, and a dropdown with nothing in it is worse
 * than a slightly stale one.
 *
 * Reading the same store the validator reads is the whole point — a student
 * must never be offered a choice the server will then refuse.
 */
@Injectable()
export class ReferenceService {
  constructor(private optionSets: OptionSetsService) {}

  /** The stored list if there is one, otherwise what shipped. */
  private list(key: string, fallback: readonly string[]): readonly string[] {
    const stored = this.optionSets.valuesFor(key);
    return stored.length ? stored : fallback;
  }

  geo() {
    return {
      countries: COUNTRIES,
      indiaStates: this.list('indiaStates', INDIA_STATES),
      /**
       * The whole flat list stays, because it is what an answer is validated
       * against; `citiesByState` is what the form narrows the dropdown with.
       */
      indiaCities: this.list('indiaCities', INDIA_CITIES),
      citiesByState: CITIES_BY_STATE
    };
  }

  studyPreferences() {
    return {
      studyCountries: this.list('studyCountries', STUDY_COUNTRIES),
      mbbsOnlyCountries: MBBS_ONLY_COUNTRIES,
      studyLevels: this.list('studyLevels', PROGRAM_LEVELS),
      fieldsOfStudy: this.list('fieldsOfStudy', FIELDS_OF_STUDY),
      intakeOptions: this.list('intakeOptions', INTAKE_OPTIONS),
      startYears: this.list('startYears', START_YEARS)
    };
  }

  academicInformation() {
    return {
      qualificationOptions: this.list('qualificationOptions', QUALIFICATION_OPTIONS),
      curriculumOptions: this.list('curriculumOptions', CURRICULUM_OPTIONS),
      educationGapOptions: this.list('educationGapOptions', EDUCATION_GAP_OPTIONS),
      educationYears: this.list('educationYears', EDUCATION_YEARS),
      universityOptions: this.list('universityOptions', UNIVERSITY_OPTIONS)
    };
  }

  englishExam() {
    return { englishExamOptions: this.list('englishExamOptions', ENGLISH_EXAM_OPTIONS), examStatusOptions: this.list('examStatusOptions', EXAM_STATUS_OPTIONS) };
  }

  competitiveExam() {
    return { competitiveExamOptions: this.list('competitiveExamOptions', COMPETITIVE_EXAM_OPTIONS), examStatusOptions: this.list('examStatusOptions', EXAM_STATUS_OPTIONS) };
  }

  workExperience() {
    return { employmentTypes: this.list('employmentTypes', EMPLOYMENT_TYPES) };
  }

  financialInformation() {
    return {
      fundingSourceOptions: this.list('fundingSourceOptions', FUNDING_SOURCE_OPTIONS),
      earningMemberOptions: this.list('earningMemberOptions', EARNING_MEMBER_OPTIONS),
      currencyOptions: this.list('currencyOptions', CURRENCY_OPTIONS),
      financialDocumentFields: FINANCIAL_DOCUMENT_FIELDS
    };
  }

  projectsAchievements() {
    return { achievementSuggestions: ACHIEVEMENT_SUGGESTIONS };
  }

  /** The document checklist the student profile page renders. */
  documents() {
    return { profileDocumentTypes: PROFILE_DOCUMENT_TYPES };
  }

  /** Offer-condition presets an officer can insert into an invitation, with the
   *  `[PLACEHOLDER]` tokens still in place for the UI to fill. */
  offerConditions() {
    return {
      presets: OFFER_CONDITION_PRESETS.map((preset, index) => ({
        id: `preset_${index}`,
        category: preset.cat,
        text: preset.text,
        vars: [...preset.text.matchAll(/\[(.*?)\]/g)].map(match => match[1])
      }))
    };
  }

  organizationOptions() {
    return { plans: SUBSCRIPTION_PLAN_OPTIONS, bankEvaluationModes: BANK_EVALUATION_MODE_OPTIONS };
  }
}
