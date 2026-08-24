/**
 * The shape of an admin-authored student form.
 *
 * One published schema drives three things: what the student portal renders,
 * what the backend accepts, and what the completion percentage counts. Defining
 * it once and using it in all three places is the same principle the reference
 * data already follows.
 */

export type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'number'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'date'
  | 'composite';

/**
 * Repeating blocks: an academic history with one row per qualification level,
 * exams with one row per test, roles, projects.
 *
 * Their *contents* are editable like any other field — see `itemFields`. What
 * stays in code is what drives the row set and what the server derives from it:
 * one academic row per level the student ticked, one income row per earning
 * member they named, a CGPA read off the highest qualification.
 */
export type CompositeKind =
  | 'academicHistory'
  | 'englishExams'
  | 'competitiveExams'
  | 'workExperiences'
  | 'earnerIncomes'
  | 'projectList'
  | 'tagList';

export interface FieldValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  /** Anchored server-side before use; an admin-supplied pattern is never trusted raw. */
  pattern?: string;
  message?: string;
}

/** Shows a field only when another answer in the same section matches. */
export interface VisibilityRule {
  field: string;
  equals: string[];
}

export interface FormFieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  helpText?: string;
  required: boolean;
  enabled: boolean;
  order: number;
  /** Fixed options, or a `reference:` pointer into the reference-data endpoints. */
  options?: string[];
  optionsSource?: string;
  validation?: FieldValidation;
  visibleWhen?: VisibilityRule;
  composite?: CompositeKind;
  /**
   * For a composite: the fields of one row, so its contents are data an admin
   * can edit rather than a list buried in a component.
   *
   * A row's own values decide which of them show, through the same `visibleWhen`
   * rule fields use elsewhere — an academic row keyed on its qualification level,
   * an exam row on its status. Whatever the *row set* is driven by (one row per
   * qualification the student ticked, one per earning member they named) stays in
   * code: that is the composite's behaviour, and it is not a field list.
   */
  itemFields?: FormFieldDef[];
  /** For a select: lets someone type a value the option list does not carry. */
  allowCustom?: boolean;
  /** The heading this field sits under, by group key. */
  group?: string;
  /**
   * A line of explanation under one option, keyed by the option itself — the
   * "IELTS, TOEFL, PTE or DET" beneath a Yes. Options a hint does not name are
   * shown plainly.
   */
  optionHints?: Record<string, string>;
  /** Full width in the two-column grid. */
  wide?: boolean;
}

/**
 * A heading within a section, above the fields assigned to it.
 *
 * Groups are the section's own, so renaming one is a single edit rather than a
 * change to every field beneath it.
 */
export interface FormGroupDef {
  key: string;
  label: string;
  order: number;
}

export interface FormSectionDef {
  key: string;
  label: string;
  /** Headings within the section; fields point at one by key. */
  groups?: FormGroupDef[];
  description?: string;
  /** The student-portal route that renders it. */
  route: string;
  /** Which JSON column on the profile it writes. */
  column: string;
  order: number;
  enabled: boolean;
  fields: FormFieldDef[];
}

export interface FormSchemaDef {
  /** `DEFAULT`, or a per-audience variant such as `UG` or `PG`. */
  variant: string;
  label: string;
  sections: FormSectionDef[];
}

// ── What the matching engine cannot do without ──────────────────────────────

export interface EngineDependency {
  section: string;
  field: string;
  /** Plain-English list of what stops working when this field goes missing. */
  usedBy: string[];
}

/**
 * Every *input* field the discovery projection, match scoring, org filters or
 * the completion gate ultimately depends on.
 *
 * Only fields a student actually fills in belong here. Values the server derives
 * — CGPA from the academic history, the English score from the first test entry,
 * household income from the per-earner amounts — are named in `usedBy` instead,
 * because removing them is not something an admin can do directly.
 *
 * An admin is allowed to remove any of these — but the publish step names the
 * consequences first, and a health check reports anything already missing, so a
 * broken filter is never a silent surprise.
 */
export const ENGINE_DEPENDENCIES: EngineDependency[] = [
  { section: 'personalInformation', field: 'fullName', usedBy: ['Candidate name in discovery', 'Completion'] },
  { section: 'personalInformation', field: 'email', usedBy: ['Completion'] },
  { section: 'personalInformation', field: 'mobileNumber', usedBy: ['Completion'] },
  { section: 'personalInformation', field: 'country', usedBy: ['Candidate origin', 'Completion'] },
  { section: 'personalInformation', field: 'city', usedBy: ['Candidate location', 'Completion'] },

  { section: 'studyPreferences', field: 'countries', usedBy: ['Destination filter', 'Country & intake score', 'Completion'] },
  { section: 'studyPreferences', field: 'fieldOfInterest', usedBy: ['Course filter', 'Course alignment score', 'Completion'] },
  { section: 'studyPreferences', field: 'studyLevel', usedBy: ['Degree-level filter'] },
  { section: 'studyPreferences', field: 'intake', usedBy: ['Intake filter', 'Country & intake score', 'Completion'] },
  { section: 'studyPreferences', field: 'startYear', usedBy: ['Completion'] },

  /** CGPA, institution, qualification level and graduation year are all derived
   *  from this history rather than entered separately. */
  {
    section: 'academicInformation',
    field: 'history',
    usedBy: [
      'Minimum-CGPA filter and academic fit score',
      'Institution, qualification and graduation year on the candidate card',
      'Backlogs filter',
      'Completion'
    ]
  },

  /** The English test name and score shown to organizations come from the first entry. */
  {
    section: 'englishExam',
    field: 'englishExams',
    usedBy: ['English-test filter', 'Minimum-English-score filter', 'Test score fit', 'Completion']
  },

  /** GRE and GMAT are read off the first competitive entry. */
  {
    section: 'competitiveExam',
    field: 'competitiveExams',
    usedBy: ['GRE and GMAT filters', 'Test score fit', 'Completion']
  },

  { section: 'workExperience', field: 'workStatus', usedBy: ['Work-experience filter', 'Completion'] },
  { section: 'workExperience', field: 'relevantYears', usedBy: ['Work-experience filter'] },
  { section: 'workExperience', field: 'nonRelevantYears', usedBy: ['Work-experience filter'] },

  { section: 'financialInformation', field: 'fundingSource', usedBy: ['Scholarship-seeking filter', 'Completion'] },
  /** Household income is summed from the per-earner amounts. */
  {
    section: 'financialInformation',
    field: 'earningMembers',
    usedBy: ['Household-income filter', 'Financial need score', 'Required-loan filter']
  },
  { section: 'financialInformation', field: 'currency', usedBy: ['Income display', 'Completion'] },
  { section: 'financialInformation', field: 'employmentCategory', usedBy: ['Loan document checklist', 'Completion'] },
  { section: 'financialInformation', field: 'needsLoan', usedBy: ['Loan document checklist', 'Required-loan filter', 'Completion'] },

  { section: 'projectsAchievements', field: 'projects', usedBy: ['Completion'] },
  { section: 'projectsAchievements', field: 'achievements', usedBy: ['Skills on the candidate card'] }
];

/** Engine dependencies a given schema no longer satisfies. */
export function missingEngineFields(
  schema: FormSchemaDef,
  /** Which set to check. Each form declares its own; they are not the same. */
  dependencies: EngineDependency[] = ENGINE_DEPENDENCIES
): EngineDependency[] {
  return dependencies.filter(dependency => {
    const section = schema.sections.find(candidate => candidate.key === dependency.section);
    if (!section || !section.enabled) return true;
    const field = section.fields.find(candidate => candidate.key === dependency.field);
    return !field || !field.enabled;
  });
}
