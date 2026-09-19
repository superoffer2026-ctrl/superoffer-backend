import { FormFieldDef, FormSchemaDef, FormSectionDef } from './form-schema.types';

/**
 * The form exactly as it is coded today, expressed as data.
 *
 * Seeding from this means switching the portal over to the schema changes
 * nothing a student sees — it just moves the definition somewhere an admin can
 * edit it. Every subsequent version is a diff against this one.
 */

const field = (
  key: string,
  label: string,
  type: FormFieldDef['type'],
  order: number,
  extra: Partial<FormFieldDef> = {}
): FormFieldDef => ({
  key,
  label,
  type,
  order,
  required: false,
  enabled: true,
  ...extra
});

/**
 * One field of a repeating row. Same shape as any other field, so the builder
 * and the renderers treat a row exactly like a section.
 */
const item = (
  key: string,
  label: string,
  type: FormFieldDef['type'],
  order: number,
  extra: Partial<FormFieldDef> = {}
): FormFieldDef => field(key, label, type, order, extra);

/** The qualification levels whose rows carry a degree rather than a curriculum. */
const TERTIARY = ['Diploma', "Bachelor's Degree", "Master's Degree", 'PhD'];
const DEGREE_LEVELS = ["Bachelor's Degree", "Master's Degree", 'PhD'];
const SCHOOL_LEVELS = ['11th', '12th'];
const ALL_LEVELS = [...SCHOOL_LEVELS, ...TERTIARY];

const PERSONAL: FormSectionDef = {
  key: 'personalInformation',
  label: 'Personal Information',
  description: 'Basic student details',
  route: 'personal-information',
  column: 'personal',
  order: 1,
  enabled: true,
  fields: [
    field('fullName', 'Full Name', 'text', 1, { required: true, placeholder: 'Aarav Mehta' }),
    field('email', 'Email Address', 'email', 2, { required: true, placeholder: 'aarav@example.com' }),
    field('mobileCountry', 'Mobile country code', 'select', 3, { optionsSource: 'reference:dialCodes' }),
    field('mobileNumber', 'Mobile Number', 'tel', 4, { required: true, placeholder: '98765 43210' }),
    field('altMobileCountry', 'Additional mobile country code', 'select', 5, { optionsSource: 'reference:dialCodes' }),
    field('altMobileNumber', 'Additional Mobile Number', 'tel', 6, { placeholder: 'Optional' }),
    field('country', 'Country', 'select', 7, { required: true, optionsSource: 'reference:countries' }),
    field('state', 'State', 'select', 8, { required: true, optionsSource: 'reference:indiaStates', allowCustom: true }),
    field('city', 'Current City', 'select', 9, { required: true, optionsSource: 'reference:indiaCities', allowCustom: true })
  ]
};

const STUDY: FormSectionDef = {
  key: 'studyPreferences',
  label: 'Study Preferences',
  description: 'Future study interests',
  route: 'study-preferences',
  column: 'studyPreferences',
  order: 2,
  enabled: true,
  fields: [
    field('countries', 'Which country do you want to study in?', 'multiselect', 1, {
      required: true,
      optionsSource: 'reference:studyCountries'
    }),
    field('studyLevel', 'What do you want to study?', 'multiselect', 2, {
      required: true,
      optionsSource: 'reference:studyLevels'
    }),
    field('fieldOfInterest', 'Program of Interest', 'multiselect', 3, {
      required: true,
      optionsSource: 'reference:fieldsOfStudy'
    }),
    field('startYear', 'When do you plan to start studying?', 'multiselect', 4, {
      required: true,
      optionsSource: 'reference:startYears'
    }),
    field('intake', 'Preferred Intake', 'multiselect', 5, {
      required: true,
      optionsSource: 'reference:intakeOptions'
    })
  ]
};

const ACADEMIC: FormSectionDef = {
  key: 'academicInformation',
  label: 'Academic Information',
  description: 'Education background',
  route: 'academic-information',
  column: 'academic',
  order: 3,
  enabled: true,
  fields: [
    field('history', 'Academic history', 'composite', 1, {
      required: true,
      composite: 'academicHistory',
      helpText: 'One entry per qualification level; the fields shown depend on the level.',
      /** One row per level the student ticked; `level` decides what that row asks. */
      itemFields: [
        item('curriculum', 'Curriculum', 'select', 1, {
          required: true,
          optionsSource: 'reference:curriculumOptions',
          visibleWhen: { field: 'level', equals: SCHOOL_LEVELS }
        }),
        item('degreeName', 'Degree Name', 'text', 2, {
          required: true,
          placeholder: 'e.g. B.Tech, B.Sc, B.Com',
          visibleWhen: { field: 'level', equals: DEGREE_LEVELS }
        }),
        item('specialization', 'Specialization', 'text', 3, {
          required: true,
          placeholder: 'e.g. Computer Science',
          visibleWhen: { field: 'level', equals: TERTIARY }
        }),
        item('institutionName', 'University / College Name', 'select', 4, {
          required: true,
          optionsSource: 'reference:universityOptions',
          allowCustom: true,
          wide: true,
          visibleWhen: { field: 'level', equals: TERTIARY }
        }),
        item('cgpa', 'CGPA / Percentage', 'text', 5, {
          required: true,
          placeholder: 'e.g. 8.7 CGPA or 85%',
          visibleWhen: { field: 'level', equals: ALL_LEVELS },
          /** 11th and 12th are marked as a percentage; there is no CGPA to give. */
          labelWhen: { field: 'level', equals: SCHOOL_LEVELS, label: 'Percentage', placeholder: 'e.g. 85%' }
        }),
        item('backlogs', 'Number of Backlogs', 'number', 6, {
          required: true,
          placeholder: 'e.g. 0',
          validation: { min: 0 },
          visibleWhen: { field: 'level', equals: TERTIARY }
        }),
        item('startedYear', 'Started Year', 'select', 7, {
          required: true,
          optionsSource: 'reference:educationYears',
          visibleWhen: { field: 'level', equals: ALL_LEVELS }
        }),
        item('completionYear', 'Completion Year', 'select', 8, {
          required: true,
          optionsSource: 'reference:educationYears',
          visibleWhen: { field: 'level', equals: ALL_LEVELS }
        }),
        item('yearsOfEducation', 'Years of Education', 'number', 9, {
          required: true,
          placeholder: 'e.g. 10',
          validation: { min: 0 },
          visibleWhen: { field: 'level', equals: DEGREE_LEVELS }
        })
      ]
    }),
    field('educationGap', 'Education Gap', 'select', 2, { optionsSource: 'reference:educationGapOptions' })
  ]
};

const ENGLISH: FormSectionDef = {
  key: 'englishExam',
  label: 'English Exam',
  description: 'English proficiency exams',
  route: 'english-exam',
  column: 'entranceExams',
  order: 4,
  enabled: true,
  fields: [
    field('attended', 'Have you taken or are preparing for an English proficiency exam?', 'select', 1, {
      required: true,
      options: ['Yes', 'No'],
      optionHints: {
        Yes: 'IELTS, TOEFL, PTE or DET',
        No: "I haven't attempted any English exam yet"
      },
      helpText: "No exams selected yet - that's fine if it doesn't apply to you."
    }),
    field('englishExams', 'Which exam(s) have you taken or are preparing for?', 'composite', 2, {
      required: true,
      /** Only asked once the student says they have an exam to declare. */
      visibleWhen: { field: 'attended', equals: ['Yes'] },
      composite: 'englishExams',
      helpText: 'Which score fields are required depends on the status of each test.',
      /** Each exam is scored on its own scale, so each carries its own example. */
      optionHints: {
        IELTS: 'Band 0-9, e.g. 7.5',
        'TOEFL (New)': 'Score 0-120, e.g. 100',
        'TOEFL (Old)': 'Score 310-677, e.g. 550',
        PTE: 'Score 10-90, e.g. 65',
        DET: 'Score 10-160, e.g. 120'
      },
      /** One row per test; `status` decides which scores that row asks for. */
      itemFields: [
        item('status', 'Status', 'select', 1, { required: true, optionsSource: 'reference:examStatusOptions' }),
        item('score', 'Score', 'text', 2, {
          required: true,
          placeholder: 'e.g. 7.5',
          visibleWhen: { field: 'status', equals: ['I have the score'] }
        }),
        item('currentScore', 'Current Score', 'text', 3, {
          required: true,
          placeholder: 'e.g. 6.5',
          visibleWhen: { field: 'status', equals: ['Retake'] }
        }),
        item('expectedScore', 'Expected Score', 'text', 4, {
          required: true,
          placeholder: 'e.g. 7.5',
          visibleWhen: { field: 'status', equals: ['Awaiting Result', 'Yet to be taken', 'Retake'] }
        })
      ]
    })
  ]
};

const COMPETITIVE: FormSectionDef = {
  key: 'competitiveExam',
  label: 'Competitive Exam',
  description: 'GRE, GMAT and similar',
  route: 'competitive-exam',
  column: 'entranceExams',
  order: 5,
  enabled: true,
  fields: [
    field('attended', 'Have you taken or are preparing for a standardised test?', 'select', 1, {
      required: true,
      options: ['Yes', 'No'],
      optionHints: {
        Yes: 'GRE, GMAT or similar',
        No: "I haven't attempted any standardised test yet"
      },
      helpText: "No exams selected yet - that's fine if it doesn't apply to you."
    }),
    field('competitiveExams', 'Which exam(s) have you taken or are preparing for?', 'composite', 2, {
      required: true,
      /** Only asked once the student says they have an exam to declare. */
      visibleWhen: { field: 'attended', equals: ['Yes'] },
      composite: 'competitiveExams',
      helpText: 'Which score fields are required depends on the status of each test.',
      /** Each exam is scored on its own scale, so each carries its own example. */
      optionHints: {
        GRE: 'Score 260-340, e.g. 320',
        'GMAT (Focus)': 'Score 205-805, e.g. 645',
        'GMAT (Classic)': 'Score 200-800, e.g. 650'
      },
      /** One row per test; `status` decides which scores that row asks for. */
      itemFields: [
        item('status', 'Status', 'select', 1, { required: true, optionsSource: 'reference:examStatusOptions' }),
        item('score', 'Score', 'text', 2, {
          required: true,
          placeholder: 'e.g. 7.5',
          visibleWhen: { field: 'status', equals: ['I have the score'] }
        }),
        item('currentScore', 'Current Score', 'text', 3, {
          required: true,
          placeholder: 'e.g. 6.5',
          visibleWhen: { field: 'status', equals: ['Retake'] }
        }),
        item('expectedScore', 'Expected Score', 'text', 4, {
          required: true,
          placeholder: 'e.g. 7.5',
          visibleWhen: { field: 'status', equals: ['Awaiting Result', 'Yet to be taken', 'Retake'] }
        })
      ]
    })
  ]
};

const WORK: FormSectionDef = {
  key: 'workExperience',
  label: 'Work Experience',
  description: 'Relevant and non-relevant experience',
  route: 'work-experience',
  column: 'workExperience',
  order: 6,
  enabled: true,
  fields: [
    field('workStatus', 'Are you working?', 'select', 1, { required: true, options: ['Fresher', 'Yes'] }),
    field('relevantYears', 'Relevant experience (years)', 'number', 2, {
      visibleWhen: { field: 'workStatus', equals: ['Yes'] },
      validation: { min: 0, max: 50 }
    }),
    field('nonRelevantYears', 'Other experience (years)', 'number', 3, {
      visibleWhen: { field: 'workStatus', equals: ['Yes'] },
      validation: { min: 0, max: 50 }
    }),
    field('experiences', 'Roles', 'composite', 4, {
      composite: 'workExperiences',
      visibleWhen: { field: 'workStatus', equals: ['Yes'] },
      itemFields: [
        item('companyName', 'Company', 'text', 1, { required: true, placeholder: 'e.g. Acme Corp' }),
        item('role', 'Role', 'text', 2, { required: true, placeholder: 'e.g. Software Engineering Intern' }),
        item('type', 'Employment type', 'select', 3, { required: true, optionsSource: 'reference:employmentTypes' }),
        item('durationMonths', 'Duration in months', 'number', 4, {
          required: true,
          placeholder: 'e.g. 6',
          validation: { min: 0 }
        }),
        item('description', 'What you worked on', 'textarea', 5, {
          wide: true,
          placeholder: 'What did you work on?'
        })
      ]
    })
  ]
};

const FINANCIAL: FormSectionDef = {
  key: 'financialInformation',
  label: 'Financial Information',
  groups: [
    { key: 'funding', label: 'Education Funding', order: 1 },
    { key: 'background', label: 'Financial Background', order: 2 },
    { key: 'loan', label: 'Education Loan', order: 3 }
  ],
  description: 'Funding and financial background',
  route: 'financial-information',
  column: 'financial',
  order: 7,
  enabled: true,
  fields: [
    field('fundingSource', 'How will you fund your studies?', 'select', 1, {
      group: 'funding',
      required: true,
      optionsSource: 'reference:fundingSourceOptions'
    }),
    field('earningMembers', 'Earning members', 'multiselect', 2, {
      group: 'background',
      required: true,
      optionsSource: 'reference:earningMemberOptions'
    }),
    field('earnerIncomes', 'Annual income per earner', 'composite', 3, {
      group: 'background',
      composite: 'earnerIncomes',
      helpText: 'One income field per selected earner; the household total is computed from them.',
      /** Which of these show is driven by the earners named above, not by a row value. */
      itemFields: [
        item('fatherIncome', "Father's Annual Income", 'text', 1, { required: true, placeholder: 'e.g. 10,00,000' }),
        item('motherIncome', "Mother's Annual Income", 'text', 2, { required: true, placeholder: 'e.g. 6,00,000' }),
        item('guardianIncome', "Guardian's Annual Income", 'text', 3, { required: true, placeholder: 'e.g. 8,00,000' })
      ]
    }),
    field('currency', 'Currency', 'select', 4, {
      group: 'background', required: true, optionsSource: 'reference:currencyOptions' }),
    /**
     * Employment category and the two declaration checkboxes were removed from
     * the student wizard: they belong to the lending conversation, and are being
     * rebuilt inside the bank module rather than asked of every student up front.
     */
    field('needsLoan', 'Do you need an education loan?', 'select', 5, {
      group: 'loan', required: true, options: ['yes', 'no'] })
  ]
};

/**
 * Financial eligibility for an education loan — asked as a short, one-question-
 * at-a-time flow rather than a single long form, then an optional credit check.
 *
 * The student stays the user throughout; the questions are about whoever is
 * financially supporting them (a parent, a guardian, themselves, or someone
 * else), because a lender reads that person's income and credit record, not
 * the student's. The identity fields exist only because a credit bureau needs
 * them to match a person — asked once, right before the check, not up front.
 */
const CO_APPLICANT: FormSectionDef = {
  key: 'coApplicant',
  label: 'Parent or Guardian',
  description: 'The co-applicant on an education loan',
  /** No wizard route — reached from the dashboard's loan flow instead, not as an onboarding step. */
  route: '',
  column: 'coApplicant',
  order: 8,
  enabled: true,
  groups: [
    { key: 'income', label: 'Financial eligibility', order: 1 },
    { key: 'declaration', label: 'Declaration', order: 2 },
    /** The CIBIL form: the identity the bureau matches on, asked at the check. */
    { key: 'identity', label: 'Who they are', order: 3 }
  ],
  fields: [
    field('relationship', 'Who will be financially supporting your education?', 'select', 1, {
      group: 'income',
      required: true,
      options: ['Parent', 'Guardian', 'Self', 'Other']
    }),
    field('employmentType', 'What is their employment or income type?', 'select', 2, {
      group: 'income',
      required: true,
      /** Matches the casing FINANCIAL_DOCUMENT_FIELDS.categories keys off, so this
       *  answer is what decides which income proofs a lender is shown. */
      options: ['Salaried', 'Self-Employed', 'Business', 'Agriculture', 'Other']
    }),
    field('monthlyIncome', 'What is their approximate monthly income?', 'number', 3, {
      group: 'income',
      required: true,
      placeholder: 'e.g. 85000',
      validation: { min: 0 },
      helpText: 'Take-home pay per month, before any loan repayments.'
    }),
    field('hasExistingLoan', 'Do they currently have any loans or EMIs?', 'select', 4, {
      group: 'income',
      required: true,
      options: ['Yes', 'No']
    }),
    field('existingEmi', 'What is their approximate total monthly EMI?', 'number', 5, {
      group: 'income',
      required: true,
      placeholder: 'e.g. 12000',
      validation: { min: 0 },
      helpText: 'Everything they already repay each month, across all loans.',
      /** Informational — the step-by-step flow itself skips this question when Q4 is "No". */
      visibleWhen: { field: 'hasExistingLoan', equals: ['Yes'] }
    }),
    /**
     * Asked before the loan amount, because the two are one question in two
     * halves: what the family can put in, and what is left to borrow. A lender
     * reads the margin as commitment, and a student who has never added the two
     * up tends to overstate what they need.
     */
    field('familyContribution', 'How much can your family contribute towards your education?', 'number', 6, {
      group: 'income',
      required: true,
      placeholder: 'e.g. 500000',
      validation: { min: 0 },
      helpText: 'Savings, family support or anything already set aside — before any loan.'
    }),
    field('loanAmountRequested', 'How much financial assistance are you looking for?', 'number', 7, {
      group: 'income',
      required: true,
      placeholder: 'e.g. 2000000',
      validation: { min: 0 },
      helpText: 'A rough figure is fine — this helps lenders gauge the loan size.'
    }),
    field('name', 'Parent or Guardian Name', 'text', 8, {
      group: 'identity',
      required: true,
      placeholder: 'As printed on their PAN card',
      helpText: 'It must match their PAN exactly, or a credit check cannot identify them.'
    }),
    field('panNumber', 'PAN Number', 'text', 9, {
      group: 'identity',
      required: true,
      placeholder: 'ABCDE1234F',
      helpText: 'Stored encrypted. Only the last four characters are ever shown back.',
      validation: { pattern: '^[A-Za-z]{5}[0-9]{4}[A-Za-z]$', message: 'Enter a PAN in the form ABCDE1234F' }
    }),
    field('mobileNumber', 'Mobile Number', 'tel', 10, {
      group: 'identity',
      required: true,
      placeholder: '98765 43210',
      helpText: 'The number registered against their PAN.'
    }),
    /** The bureau matches on it, and accepts only these two values. */
    field('gender', 'Gender', 'select', 11, {
      group: 'identity',
      required: true,
      options: ['Male', 'Female']
    }),
    /**
     * Asked here rather than during profile onboarding. Confirming income is
     * accurate and consenting to share it only means something at the point a
     * lender is about to read it — up front it was a checkbox on a form the
     * student was filling in for universities.
     */
    field('declarationAccurate', 'I confirm these financial details are accurate', 'checkbox', 12, {
      group: 'declaration', required: true, wide: true
    }),
    field('declarationConsent', 'I consent to these details being shared with verified lending partners', 'checkbox', 13, {
      group: 'declaration', required: true, wide: true
    })
  ]
};

const PROJECTS: FormSectionDef = {
  key: 'projectsAchievements',
  label: 'Projects & Achievements',
  groups: [
    { key: 'presence', label: 'Social Presence', order: 1 },
    { key: 'projects', label: 'Projects', order: 2 },
    { key: 'achievements', label: 'Achievements', order: 3 }
  ],
  description: 'Experience and recognition',
  route: 'projects',
  column: 'projects',
  order: 9,
  enabled: true,
  fields: [
    field('links', 'Social presence', 'composite', 1, {
      group: 'presence',
      required: true,
      composite: 'tagList',
      helpText: 'GitHub, LinkedIn or portfolio links.',
      /** A chip carries one value, so the row is a single field. */
      itemFields: [
        item('value', 'Link', 'text', 1, { placeholder: 'Paste a GitHub, LinkedIn or portfolio link' })
      ]
    }),
    field('projects', 'Projects', 'composite', 2, {
      group: 'projects',
      required: false,
      composite: 'projectList',
      itemFields: [
        item('title', 'Title', 'text', 1, { required: true, placeholder: 'e.g. Student success prediction model' }),
        item('role', 'Your role', 'text', 2, { required: true, placeholder: 'e.g. Developer and researcher' }),
        item('description', 'What you built', 'textarea', 3, {
          wide: true,
          placeholder: 'What did you build, and what was the impact?'
        })
      ]
    }),
    field('achievements', 'Achievements', 'composite', 3, {
      group: 'achievements',
      required: true,
      composite: 'tagList',
      helpText: 'Awards, leadership, competitions or other recognition.',
      itemFields: [
        item('value', 'Achievement', 'text', 1, { placeholder: 'e.g. Hackathon Winner' })
      ]
    })
  ]
};

export const DEFAULT_FORM_SCHEMA: FormSchemaDef = {
  variant: 'DEFAULT',
  label: 'Standard student profile',
  sections: [PERSONAL, STUDY, ACADEMIC, ENGLISH, COMPETITIVE, WORK, FINANCIAL, CO_APPLICANT, PROJECTS]
};

/** A deep copy, so a caller editing a draft never mutates the seed. */
export const cloneDefaultSchema = (): FormSchemaDef =>
  JSON.parse(JSON.stringify(DEFAULT_FORM_SCHEMA)) as FormSchemaDef;
