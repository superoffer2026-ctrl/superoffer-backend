import { Injectable } from '@nestjs/common';
import { COUNTRIES, INDIA_CITIES } from './data/geo.data';
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
  START_YEARS,
  STUDY_COUNTRIES,
  UNIVERSITY_OPTIONS
} from './data/master-sheet.data';
import {
  ACHIEVEMENT_SUGGESTIONS,
  CURRENCY_OPTIONS,
  EARNING_MEMBER_OPTIONS,
  EMPLOYMENT_CATEGORY_OPTIONS,
  EMPLOYMENT_TYPES,
  FINANCIAL_DOCUMENT_FIELDS,
  FUNDING_SOURCE_OPTIONS,
  PROFILE_DOCUMENT_TYPES,
  QUALIFICATION_OPTIONS
} from './data/wizard.data';

/**
 * Serves every dropdown in the student wizard. The same constants back the DTO
 * validators in `students/dto`, so a student can never be offered an option the
 * server then rejects.
 */
@Injectable()
export class ReferenceService {
  geo() {
    return { countries: COUNTRIES, indiaCities: INDIA_CITIES };
  }

  studyPreferences() {
    return {
      studyCountries: STUDY_COUNTRIES,
      mbbsOnlyCountries: MBBS_ONLY_COUNTRIES,
      fieldsOfStudy: FIELDS_OF_STUDY,
      intakeOptions: INTAKE_OPTIONS,
      startYears: START_YEARS
    };
  }

  academicInformation() {
    return {
      qualificationOptions: QUALIFICATION_OPTIONS,
      curriculumOptions: CURRICULUM_OPTIONS,
      educationGapOptions: EDUCATION_GAP_OPTIONS,
      educationYears: EDUCATION_YEARS,
      universityOptions: UNIVERSITY_OPTIONS
    };
  }

  englishExam() {
    return { englishExamOptions: ENGLISH_EXAM_OPTIONS, examStatusOptions: EXAM_STATUS_OPTIONS };
  }

  competitiveExam() {
    return { competitiveExamOptions: COMPETITIVE_EXAM_OPTIONS, examStatusOptions: EXAM_STATUS_OPTIONS };
  }

  workExperience() {
    return { employmentTypes: EMPLOYMENT_TYPES };
  }

  financialInformation() {
    return {
      fundingSourceOptions: FUNDING_SOURCE_OPTIONS,
      employmentCategoryOptions: EMPLOYMENT_CATEGORY_OPTIONS,
      earningMemberOptions: EARNING_MEMBER_OPTIONS,
      currencyOptions: CURRENCY_OPTIONS,
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
