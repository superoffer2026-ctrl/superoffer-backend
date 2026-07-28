import { validateDocumentType, validateEducation, validateExams, validatePersonal, validatePreferences, validateSkills } from '../validation/student-profile.validation.js';

const WEIGHTS = { personal:20, education:20, preferences:20, exams:15, skills:15, documents:10 };
const sectionComplete = {
  personal:value => Boolean(value?.firstName && value?.lastName && value?.dateOfBirth && value?.phoneNumber),
  education:value => Boolean(value?.studentType && (value?.school || value?.college)),
  preferences:value => Boolean(value?.preferredCountries?.length && value?.preferredCourses?.length && value?.degreeType),
  exams:value => Boolean(value?.exams?.length),
  skills:value => Boolean(value?.technicalSkills?.length && value?.softSkills?.length && value?.languagesKnown?.length),
  documents:value => Boolean(value?.length)
};
export const completionFor = profile => {
  const sections = Object.fromEntries(Object.keys(WEIGHTS).map(key => [key, sectionComplete[key](profile[key])]));
  const profileCompletionPercentage = Object.entries(WEIGHTS).reduce((sum,[key,weight]) => sum + (sections[key] ? weight : 0), 0);
  return { sections, profileCompletionPercentage, profileComplete:profileCompletionPercentage === 100 };
};

export class StudentProfileService {
  constructor(repository) { this.repository = repository; }
  async get(user) {
    const profile = await this.repository.findStudentProfile(user.id) || { userId:user.id, documents:[] };
    return this.present(user, profile);
  }
  async save(user, section, input) {
    const validators = { personal:validatePersonal, education:validateEducation, preferences:validatePreferences, exams:validateExams, skills:validateSkills };
    const value = validators[section](input);
    const profile = await this.repository.updateStudentProfileSection(user.id, section, value);
    return this.present(user, profile);
  }
  async addDocument(user, input, file) {
    if (!file) throw Object.assign(new Error('A document file is required'), { status:400, code:'DOCUMENT_REQUIRED' });
    const documentType = validateDocumentType(input.documentType);
    const current = await this.repository.findStudentProfile(user.id) || {};
    if ((current.documents || []).some(document => document.originalName.toLowerCase() === file.originalname.toLowerCase())) {
      throw Object.assign(new Error('A document with this name already exists'), { status:409, code:'DUPLICATE_DOCUMENT_NAME' });
    }
    const document = { id:crypto.randomUUID(), documentType, originalName:file.originalname, storedName:file.filename, mimeType:file.mimetype, size:file.size, uploadedAt:new Date().toISOString(), verificationStatus:'PENDING' };
    const profile = await this.repository.addStudentDocument(user.id, document);
    return { document, profile:this.present(user, profile) };
  }
  present(user, profile) {
    const completion = completionFor(profile);
    return { ...profile, userId:user.id, email:user.email, fullName:user.fullName, ...completion };
  }
}
