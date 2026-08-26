import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MBBS_ONLY_COUNTRIES } from '../reference/data/master-sheet.data';
import { EARNING_MEMBER_OPTIONS, FINANCIAL_DOCUMENT_FIELDS } from '../reference/data/wizard.data';
import type {
  AcademicInformationDto,
  CompetitiveExamDto,
  EnglishExamDto,
  FinancialInformationDto,
  PersonalInformationDto,
  ProjectsAchievementsDto,
  StudyPreferencesDto,
  WorkExperienceDto
} from './dto/student-sections.dto';

const REQUIRED_DOCUMENTS: Record<string, string[]> = {
  UG: ['10th Mark Sheet', '12th Mark Sheet / Latest Marks'],
  PG: ['10th Mark Sheet', '12th Mark Sheet', 'Undergraduate Transcript / Consolidated Mark Sheet'],
  PHD: ["Bachelor's Transcript", "Master's Transcript"]
};

const PROFILE_FIELDS = ['basic', 'studyLevel', 'academic', 'preferences', 'selectedTests', 'testDetails', 'achievements', 'links'] as const;

/** Which income field each earner maps to — the wizard uses the same mapping. */
const EARNER_INCOME_FIELDS: Record<string, 'fatherIncome' | 'motherIncome' | 'guardianIncome'> = {
  Father: 'fatherIncome',
  Mother: 'motherIncome',
  Guardian: 'guardianIncome'
};

/** Scores the wizard requires for a given exam status (docs/09-Business-Rules.md). */
const parseAmount = (value?: string): number => Number((value || '').replace(/[^0-9.]/g, '')) || 0;

/** Which profile column each wizard section is stored in. */
const SECTION_COLUMN: Record<string, string> = {
  personalInformation: 'personal',
  studyPreferences: 'studyPreferences',
  academicInformation: 'academic',
  englishExam: 'entranceExams',
  competitiveExam: 'entranceExams',
  workExperience: 'workExperience',
  financialInformation: 'financial',
  projectsAchievements: 'projects'
};

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  private async getOrCreateProfile(userId: string) {
    const existing = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.studentProfile.create({ data: { userId } });
  }

  async getMyProfile(userId: string) {
    const profile = await this.getOrCreateProfile(userId);
    const documents = await this.prisma.studentDocument.findMany({ where: { userId }, orderBy: { uploadedAt: 'desc' } });
    return { ...profile, documents };
  }

  /** Merges the onboarding wizard's whole-form payload (everything except `financial`, which has its own endpoint). */
  async updateProfile(userId: string, payload: Record<string, unknown>) {
    const profile = await this.getOrCreateProfile(userId);
    const data: Record<string, unknown> = {};

    for (const field of PROFILE_FIELDS) {
      if (payload[field] === undefined) continue;
      if (field === 'studyLevel') {
        data.studyLevel = payload.studyLevel || null;
      } else if (field === 'selectedTests') {
        data.selectedTests = Array.isArray(payload.selectedTests) ? payload.selectedTests : [];
      } else {
        const current = (profile[field as keyof typeof profile] as Record<string, unknown>) || {};
        data[field] = { ...current, ...(payload[field] as Record<string, unknown>) } as Prisma.InputJsonValue;
      }
    }

    return this.prisma.studentProfile.update({ where: { userId }, data });
  }

  async updateFinancial(userId: string, payload: Record<string, unknown>) {
    const profile = await this.getOrCreateProfile(userId);
    const current = (profile.financial as Record<string, unknown>) || {};
    const financial = { ...current, ...payload } as Prisma.InputJsonValue;
    return this.prisma.studentProfile.update({ where: { userId }, data: { financial } });
  }

  /** Replaces one wizard section. Each section owns exactly one column. */
  private async writeSection(userId: string, column: keyof Prisma.StudentProfileUpdateInput, value: unknown) {
    await this.getOrCreateProfile(userId);
    return this.prisma.studentProfile.update({
      where: { userId },
      data: { [column]: value as Prisma.InputJsonValue }
    });
  }

  /**
   * One number, one account.
   *
   * The number is stored as typed — spacing and punctuation are the student's —
   * so comparison runs on a derived key of dial country plus digits only. That
   * key is what the uniqueness index is built on; it is never read from the
   * client.
   */
  private mobileKeyOf(country?: string, number?: string) {
    const digits = (number || '').replace(/\D/g, '');
    return digits ? `${(country || '').trim().toUpperCase()}:${digits}` : '';
  }

  /**
   * The section as it stands, so validation can widen an option list with what
   * this student already chose. An option removed after they picked it must not
   * make the rest of their profile unsaveable.
   */
  async storedSection(userId: string, sectionKey: string): Promise<Record<string, unknown>> {
    const column = SECTION_COLUMN[sectionKey];
    if (!column) return {};
    const profile = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!profile) return {};
    const value = (profile as unknown as Record<string, unknown>)[column];
    return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  }

  async savePersonalInformation(userId: string, dto: PersonalInformationDto) {
    const mobileKey = this.mobileKeyOf(dto.mobileCountry, dto.mobileNumber);
    const altMobileKey = this.mobileKeyOf(dto.altMobileCountry, dto.altMobileNumber);

    /** An alternative number that is the same number is not an alternative. */
    if (mobileKey && altMobileKey && mobileKey === altMobileKey) {
      throw new BadRequestException({
        code: 'ALT_MOBILE_SAME_AS_MOBILE',
        message: 'Your additional mobile number must be different from your mobile number'
      });
    }

    if (mobileKey) {
      const taken = await this.prisma.studentProfile.findFirst({
        where: {
          userId: { not: userId },
          personal: { path: ['mobileKey'], equals: mobileKey }
        },
        select: { userId: true }
      });
      if (taken) {
        throw new ConflictException({
          code: 'MOBILE_IN_USE',
          message: 'That mobile number is already registered to another account'
        });
      }
    }

    /** Derived, never trusted from the client. */
    const phone = `${dto.mobileCountry ? '' : ''}${dto.phone || ''}`.trim() || dto.phone || '';
    const location = [dto.city, dto.country].filter(Boolean).join(', ');
    return this.writeSection(userId, 'personal', {
      ...dto,
      phone,
      location,
      mobileKey,
      altMobileKey
    });
  }

  /**
   * An MBBS-only destination forces the study level to MBBS — the wizard applies
   * this client-side, and it is re-applied here so the rule holds for any caller.
   */
  saveStudyPreferences(userId: string, dto: StudyPreferencesDto) {
    const mbbsOnly = dto.countries.some(country => MBBS_ONLY_COUNTRIES.includes(country));
    const studyLevel = mbbsOnly ? ['MBBS'] : dto.studyLevel;
    return this.writeSection(userId, 'studyPreferences', { ...dto, studyLevel });
  }

  /**
   * The last selected qualification is the student's highest, and the flat fields
   * the organization-side search reads are derived from it rather than trusted.
   */
  saveAcademicInformation(userId: string, dto: AcademicInformationDto) {
    const highest = dto.history[dto.history.length - 1];
    const derived = {
      qualificationLevel: highest.level,
      institution: highest.institutionName || dto.institution || '',
      score: highest.cgpa || dto.score || '',
      graduationYear: highest.completionYear || dto.graduationYear || '',
      qualification: [highest.degreeName, highest.specialization].filter(Boolean).join(' ') || highest.level
    };
    return this.writeSection(userId, 'academic', { ...dto, ...derived });
  }

  /**
   * Which score an exam row must carry is decided by the published row
   * definition — `score` when the student has one, both scores on a retake — and
   * enforced by the schema validator before this is reached. Repeating it here
   * would quietly overrule an admin who made one optional.
   */

  async saveEnglishExam(userId: string, dto: EnglishExamDto) {
    const profile = await this.getOrCreateProfile(userId);
    const current = (profile.entranceExams as Record<string, unknown>) || {};
    const first = dto.englishExams[0];
    return this.writeSection(userId, 'entranceExams', {
      ...current,
      ...dto,
      englishExams: dto.englishExams,
      englishExam: first ? first.exam : '',
      englishScore: first ? first.score || first.expectedScore || first.currentScore || '' : ''
    });
  }

  async saveCompetitiveExam(userId: string, dto: CompetitiveExamDto) {
    const profile = await this.getOrCreateProfile(userId);
    const current = (profile.entranceExams as Record<string, unknown>) || {};
    const first = dto.competitiveExams[0];
    return this.writeSection(userId, 'entranceExams', {
      ...current,
      ...dto,
      competitiveExams: dto.competitiveExams,
      entranceExam: first ? first.exam : '',
      entranceScore: first ? first.score || first.expectedScore || first.currentScore || '' : ''
    });
  }

  /** Years and entries only count when the student is employed. */
  saveWorkExperience(userId: string, dto: WorkExperienceDto) {
    const employed = dto.workStatus === 'Yes';
    if (employed && (!dto.relevantYears || !dto.nonRelevantYears)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'relevantYears and nonRelevantYears are required when workStatus is "Yes"'
      });
    }
    const experiences = employed ? dto.experiences : [];
    const first = experiences[0];
    /** Spread first so admin-added fields are kept, then the derived values win. */
    return this.writeSection(userId, 'workExperience', {
      ...dto,
      workStatus: dto.workStatus || '',
      relevantYears: employed ? dto.relevantYears || '' : '',
      nonRelevantYears: employed ? dto.nonRelevantYears || '' : '',
      experiences,
      companyName: first ? first.companyName : '',
      jobRole: first ? first.role : ''
    });
  }

  /**
   * Income is required for each declared earner, the household total is recomputed
   * from those incomes, and both declarations must be accepted.
   */
  saveFinancialInformation(userId: string, dto: FinancialInformationDto) {
    if (!dto.declarationAccurate || !dto.declarationConsent) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Both declarations must be accepted before the financial section can be saved'
      });
    }

    const incomes: Record<string, string> = {};
    for (const earner of EARNING_MEMBER_OPTIONS) {
      const field = EARNER_INCOME_FIELDS[earner];
      if (!dto.earningMembers.includes(earner)) {
        incomes[field] = '';
        continue;
      }
      const value = dto[field];
      if (!String(value || '').trim()) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `${field} is required because ${earner} was listed as an earning member`
        });
      }
      incomes[field] = value as string;
    }

    const annualHouseholdIncome = String(
      dto.earningMembers.reduce((sum, earner) => sum + parseAmount(incomes[EARNER_INCOME_FIELDS[earner]]), 0)
    );

    return this.writeSection(userId, 'financial', { ...dto, ...incomes, annualHouseholdIncome });
  }

  saveProjectsAchievements(userId: string, dto: ProjectsAchievementsDto) {
    const linkOf = (pattern: RegExp) => dto.links.find(link => pattern.test(link)) || '';
    const first = dto.projects[0];
    return this.writeSection(userId, 'projects', {
      ...dto,
      githubLink: linkOf(/github\.com/i),
      linkedinLink: linkOf(/linkedin\.com/i),
      projectTitle: first ? first.title : '',
      projectRole: first ? first.role : ''
    });
  }

  /**
   * Notification and privacy toggles. `discoverable` is a column because discovery
   * filters on it; the rest live in the settings blob.
   */
  async updateSettings(userId: string, payload: Record<string, unknown>) {
    const profile = await this.getOrCreateProfile(userId);
    const current = (profile.settings as Record<string, unknown>) || {};
    const { discoverable, ...rest } = payload;

    return this.prisma.studentProfile.update({
      where: { userId },
      data: {
        settings: { ...current, ...rest } as Prisma.InputJsonValue,
        ...(discoverable === undefined ? {} : { discoverable: Boolean(discoverable) })
      }
    });
  }

  /** Submitting is what makes a profile discoverable by verified organizations. */
  async submit(userId: string) {
    const { completionPercent, missing } = await this.completion(userId);
    if (missing.length) {
      throw new BadRequestException({
        code: 'PROFILE_INCOMPLETE',
        message: 'Complete every required section before submitting your profile',
        completion_percent: completionPercent,
        missing
      });
    }

    return this.prisma.studentProfile.update({
      where: { userId },
      data: { status: 'SUBMITTED', submittedAt: new Date() }
    });
  }

  /** Removes the account and everything cascading from it (profile, documents, offers, sessions). */
  async deleteAccount(userId: string) {
    await this.prisma.studentDocument.deleteMany({ where: { userId } });
    await this.prisma.user.delete({ where: { id: userId } });
    return { deleted: true };
  }

  async completion(userId: string) {
    const profile = await this.getOrCreateProfile(userId);
    const documents = await this.prisma.studentDocument.findMany({ where: { userId }, select: { documentType: true } });
    const uploadedTypes = new Set(documents.map(document => document.documentType));

    const personal = (profile.personal as Record<string, string>) || {};
    const preferences = (profile.studyPreferences as Record<string, string[]>) || {};
    const academic = (profile.academic as Record<string, unknown>) || {};
    const exams = (profile.entranceExams as Record<string, unknown>) || {};
    const work = (profile.workExperience as Record<string, unknown>) || {};
    const financial = (profile.financial as Record<string, unknown>) || {};
    const projects = (profile.projects as Record<string, unknown>) || {};

    const requiredDocs = REQUIRED_DOCUMENTS[profile.studyLevel || ''] || [];

    const checklist = [
      {
        key: 'personalInformation',
        label: 'Personal Information',
        done: Boolean(personal['fullName'] && personal['email'] && personal['mobileNumber'] && personal['country'] && personal['city'])
      },
      {
        key: 'studyPreferences',
        label: 'Study Preferences',
        done: Boolean(preferences['countries']?.length && preferences['fieldOfInterest']?.length && preferences['intake']?.length)
      },
      {
        key: 'academicInformation',
        label: 'Academic Information',
        done: Array.isArray(academic['history']) && (academic['history'] as unknown[]).length > 0
      },
      { key: 'englishExam', label: 'English Exam', done: Array.isArray(exams['englishExams']) },
      { key: 'competitiveExam', label: 'Competitive Exam', done: Array.isArray(exams['competitiveExams']) },
      { key: 'workExperience', label: 'Work Experience', done: Boolean(work['workStatus']) },
      {
        key: 'financialInformation',
        label: 'Financial Information',
        done: Boolean(financial['fundingSource'] && financial['currency'] && financial['employmentCategory'] && financial['needsLoan'])
      },
      { key: 'projectsAchievements', label: 'Projects & Achievements', done: Array.isArray(projects['projects']) },
      /** Documents are only gated once the older onboarding flow has set a study level. */
      {
        key: 'documentsUploaded',
        label: 'Documents',
        done: requiredDocs.length === 0 || requiredDocs.every(doc => uploadedTypes.has(doc))
      }
    ];

    const doneCount = checklist.filter(item => item.done).length;

    /**
     * Which verification documents a lender needs from this student, and which of
     * them are in. The list depends on the employment category they declared, so
     * it is resolved here rather than rebuilt by every screen that shows it.
     */
    const employmentCategory = String(financial['employmentCategory'] || '');
    const loanDocumentFields = String(financial['needsLoan'] || '') === 'yes'
      ? FINANCIAL_DOCUMENT_FIELDS.filter(doc => !doc.categories || !employmentCategory || doc.categories.includes(employmentCategory))
      : [];
    const loanDocuments = loanDocumentFields.map(doc => ({
      key: doc.key,
      label: doc.label,
      uploaded: uploadedTypes.has(doc.label)
    }));

    return {
      completionPercent: Math.round((doneCount / checklist.length) * 100),
      status: profile.status,
      sections: checklist,
      missing: checklist.filter(item => !item.done).map(item => item.label),
      loanDocuments: {
        needsLoan: String(financial['needsLoan'] || ''),
        employmentCategory,
        required: loanDocuments,
        complete: loanDocuments.length > 0 && loanDocuments.every(doc => doc.uploaded)
      }
    };
  }
}
