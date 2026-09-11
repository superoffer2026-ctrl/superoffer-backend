/**
 * Option lists the master data sheet does not cover. Each one is consumed twice —
 * served by `/reference/*` and enforced by the student DTO validators — so it must
 * be defined here once and imported, never copied (see docs/08-Reference-Data.md).
 */

/**
 * Order matters: the wizard treats the last selected entry as the student's highest
 * qualification and derives `institution` / `score` / `graduationYear` from it.
 * The strings are also the keys of the per-level field sets in the UI, so they must
 * match the frontend exactly.
 */
export const QUALIFICATION_OPTIONS: string[] = [
  '11th',
  '12th',
  'Diploma',
  "Bachelor's Degree",
  "Master's Degree",
  'PhD'
];

export const EMPLOYMENT_TYPES: string[] = [
  'Full-time',
  'Part-time',
  'Internship',
  'Contract',
  'Freelance',
  'Apprenticeship',
  'Volunteer'
];

/** `Scholarship` and `Combination of the Above` both set `scholarshipSeeking` in the search projection. */
export const FUNDING_SOURCE_OPTIONS: string[] = [
  'Self Funding',
  'Family / Parents',
  'Education Loan',
  'Scholarship',
  'Sponsorship',
  'Combination of the Above'
];

/**
 * Restricted to the three earners the wizard maps to income fields
 * (`fatherIncome` / `motherIncome` / `guardianIncome`). Adding an option here
 * without adding its income field would produce a selectable earner whose income
 * can never be captured.
 */
export const EARNING_MEMBER_OPTIONS: string[] = ['Father', 'Mother', 'Guardian'];

/** The frontend has symbols for exactly these currencies. */
export const CURRENCY_OPTIONS: string[] = ['INR', 'USD', 'GBP', 'EUR', 'CAD', 'AUD', 'AED', 'SGD'];

export const ACHIEVEMENT_SUGGESTIONS: string[] = [
  'Sports',
  'Coding',
  'Robotics',
  'Olympiads',
  'Hackathons',
  'Music',
  'Dance',
  'Leadership',
  'Public Speaking',
  'Volunteering',
  'Entrepreneurship'
];

export interface FinancialDocumentField {
  key: string;
  label: string;
  /** Omit to request the document from everyone. */
  categories?: string[];
}

/** The document checklist the student profile page shows, one row per type. */
export const PROFILE_DOCUMENT_TYPES: string[] = [
  'Academic transcript',
  'CV / résumé',
  'Passport copy',
  'Test score report'
];

export const FINANCIAL_DOCUMENT_FIELDS: FinancialDocumentField[] = [
  { key: 'incomeCertificate', label: 'Income Certificate' },
  { key: 'salarySlips', label: 'Salary Slips (Last 24 Months)', categories: ['Salaried'] },
  { key: 'payslips', label: 'Payslips (Last 24 Months)', categories: ['Salaried'] },
  { key: 'form16', label: 'Form 16 (Last 2 Financial Years)', categories: ['Salaried'] },
  {
    key: 'businessIncomeProof',
    label: 'Business Income Proof (for Self-Employed/Business Owners)',
    categories: ['Self-Employed', 'Business']
  },
  { key: 'agriculturalIncomeCertificate', label: 'Agricultural Income Certificate', categories: ['Agriculture'] },
  {
    key: 'itr',
    label: 'Income Tax Return (Last 2 Financial Years)',
    categories: ['Self-Employed', 'Business', 'Agriculture', 'Other']
  },
  { key: 'bankStatements', label: 'Bank Statements (Last 6 Months)' },
  { key: 'scholarshipLetter', label: 'Scholarship or Funding Letter (if applicable)' }
];
