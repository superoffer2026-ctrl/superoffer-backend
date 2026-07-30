const STUDY_LEVELS = new Set(['UG', 'PG', 'PHD']);
const FUNDING_PREFERENCES = new Set(['Self Funded', 'Scholarship', 'Education Loan', 'Family Sponsored', 'Combination', 'Not Sure Yet']);
const BUDGETS = new Set(['Below USD 10,000', 'USD 10,000–20,000', 'USD 20,000–30,000', 'USD 30,000–50,000', 'Above USD 50,000']);
export const DOCUMENT_TYPES = {
  UG: {
    required: ['10th Mark Sheet', '12th Mark Sheet / Latest Marks'],
    optional: ['IELTS / TOEFL / PTE / Duolingo Score Report', 'SAT Score Report', 'Achievement Certificates', 'Sports Certificates', 'Olympiad Certificates', 'Coding / Hackathon Certificates', 'Passport']
  },
  PG: {
    required: ['10th Mark Sheet', '12th Mark Sheet', 'Undergraduate Transcript / Consolidated Mark Sheet'],
    optional: ['Degree Certificate', 'Resume / CV', 'IELTS / TOEFL / PTE', 'GRE / GMAT', 'Certificates', 'Passport']
  },
  PHD: {
    required: ["Bachelor's Transcript", "Master's Transcript"],
    optional: ['Degree Certificates', 'Research Papers', 'Publications', 'Resume / CV', 'IELTS / TOEFL', 'GRE', 'Passport']
  }
};

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const bool = value => typeof value === 'boolean';

export const validateProfile = (payload, { partial = false } = {}) => {
  if (!object(payload)) return ['Request body must be a JSON object'];
  const errors = [];
  if (!partial && !STUDY_LEVELS.has(payload.studyLevel)) errors.push('studyLevel must be UG, PG, or PHD');
  if (payload.studyLevel !== undefined && !STUDY_LEVELS.has(payload.studyLevel)) errors.push('studyLevel must be UG, PG, or PHD');
  for (const section of ['basic', 'academic', 'preferences', 'achievements', 'links']) {
    if (payload[section] !== undefined && !object(payload[section])) errors.push(`${section} must be an object`);
  }
  if (payload.selectedTests !== undefined && !strings(payload.selectedTests)) errors.push('selectedTests must be an array of strings');
  if (payload.preferences?.countries !== undefined && !strings(payload.preferences.countries)) errors.push('preferences.countries must be an array of strings');
  if (payload.preferences?.intake !== undefined && !strings(payload.preferences.intake)) errors.push('preferences.intake must be an array of strings');
  if (payload.achievements?.selected !== undefined && !strings(payload.achievements.selected)) errors.push('achievements.selected must be an array of strings');
  return errors;
};

export const validateFinancial = payload => {
  if (!object(payload)) return ['Request body must be a JSON object'];
  const errors = [];
  if (!FUNDING_PREFERENCES.has(payload.fundingPreference)) errors.push('Choose a valid funding preference');
  if (!BUDGETS.has(payload.estimatedAnnualBudget)) errors.push('Choose a valid estimated annual budget');
  for (const field of ['interestedInScholarships', 'preferLowerTuition', 'needFinancialAssistance']) {
    if (!bool(payload[field])) errors.push(`${field} must be true or false`);
  }
  return errors;
};

export const validateDocumentType = (studyLevel, documentType) => {
  const config = DOCUMENT_TYPES[studyLevel];
  return Boolean(config && [...config.required, ...config.optional].includes(documentType));
};

export const completionFor = (profile, documents = []) => {
  const sections = {
    basic: Boolean(profile?.basic?.firstName && profile?.basic?.lastName && profile?.basic?.mobile && profile?.basic?.dateOfBirth && profile?.basic?.country),
    studyLevel: STUDY_LEVELS.has(profile?.studyLevel),
    academic: Boolean(profile?.academic && Object.values(profile.academic).filter(Boolean).length >= 4),
    preferences: Boolean(profile?.preferences?.course && profile?.preferences?.countries?.length && profile?.preferences?.intake?.length),
    tests: Array.isArray(profile?.selectedTests) && profile.selectedTests.length > 0,
    achievements: Boolean(profile?.achievements),
    documents: DOCUMENT_TYPES[profile?.studyLevel]?.required.every(type => documents.some(document => document.documentType === type)) || false,
    links: Boolean(profile?.links),
    financial: Boolean(profile?.financial?.fundingPreference)
  };
  const completed = Object.values(sections).filter(Boolean).length;
  return { percent: Math.round(completed / Object.keys(sections).length * 100), sections, readyToSubmit: Object.values(sections).every(Boolean) };
};
