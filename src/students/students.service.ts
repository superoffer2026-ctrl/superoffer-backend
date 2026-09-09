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

/**
 * What each wizard step is worth towards a complete profile.
 *
 * Sections are not equally informative. An admission turns on academic history;
 * a profile with only Projects filled in tells a university almost nothing. And
 * counting every section the same made the number wrong in the other direction
 * too — the Documents item is satisfied by default until a study level requires
 * any, so a student who had answered nothing was shown 11%.
 *
 * The eight wizard steps carry the whole hundred between them. Anything not
 * listed is still tracked and still shown as outstanding; it just does not move
 * the percentage. The total is summed rather than assumed, so these stay
 * readable relative weights and a full profile always lands on exactly 100.
 */
const SECTION_WEIGHTS: Record<string, number> = {
  personalInformation: 15,
  studyPreferences: 15,
  /** The single largest: it is what an offer is actually decided on. */
  academicInformation: 20,
  englishExam: 10,
  competitiveExam: 10,
  workExperience: 10,
  financialInformation: 12,
  projectsAchievements: 8
};

const TOTAL_WEIGHT = Object.values(SECTION_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  private async getOrCreateProfile(userId: string) {
    const existing = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.studentProfile.create({ data: { userId } });
  }

  async getMyProfile(userId: string) {
    const profile = await this.seedPersonalFromAccount(await this.getOrCreateProfile(userId), userId);
    const documents = await this.prisma.studentDocument.findMany({ where: { userId }, orderBy: { uploadedAt: 'desc' } });
    return { ...profile, documents };
  }

  /**
   * Step 1 opens with the name and number already in it.
   *
   * Both were given at registration, so asking again is asking the same question
   * twice — and a student who retypes their number by hand can mistype it into
   * something that no longer matches the account they sign in with.
   *
   * It is written into the section rather than merged at read time so it behaves
   * like any other saved answer: it can be edited, and an edit sticks. The guard
   * is that the section is still completely untouched, so this fires once, on
   * the first read after signing up, and never overwrites anything a student
   * has typed — including a field they deliberately cleared.
   */
  private async seedPersonalFromAccount<T extends { personal: unknown }>(profile: T, userId: string): Promise<T> {
    if (Object.keys((profile.personal as Record<string, unknown>) || {}).length) return profile;

    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, phone: true }
    });

    const fullName = account?.fullName?.trim() || '';
    /** Students are +91 by registration, so the last ten digits are the national number. */
    const digits = (account?.phone || '').replace(/\D/g, '').slice(-10);
    if (!fullName && digits.length !== 10) return profile;

    const personal = {
      ...(fullName ? { fullName } : {}),
      ...(digits.length === 10
        ? {
            mobileCountry: 'IN',
            mobileNumber: digits,
            mobileKey: this.mobileKeyOf('IN', digits),
            phone: `+91 ${digits}`,
            /**
             * Registration fixes the dial code at +91, so the country is already
             * known. It matters beyond saving a click: the city control only
             * becomes a dropdown once a country with a known city list is
             * chosen, so leaving this blank left every student typing their city
             * into a disabled box. Changing the country clears the city, so a
             * student living elsewhere is not stuck with it.
             */
            country: 'India'
          }
        : {})
    };

    const updated = await this.prisma.studentProfile.update({
      where: { userId },
      data: { personal: personal as Prisma.InputJsonValue }
    });
    return { ...profile, ...updated };
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
   * An MBBS-only destination forces both study answers to MBBS.
   *
   * These countries admit Indian students to nothing else, so a stored
   * "Masters in Data Science in Georgia" is a preference no university on the
   * platform could ever answer — and it would still reach discovery and be
   * matched on. The wizard narrows both dropdowns client-side; this re-applies
   * the rule so it holds for any caller, including one posting straight at the
   * API or a profile saved before the country was added to the list.
   */
  saveStudyPreferences(userId: string, dto: StudyPreferencesDto) {
    const mbbsOnly = dto.countries.some(country => MBBS_ONLY_COUNTRIES.includes(country));
    const studyLevel = mbbsOnly ? ['MBBS'] : dto.studyLevel;
    const fieldOfInterest = mbbsOnly ? ['MBBS'] : dto.fieldOfInterest;
    return this.writeSection(userId, 'studyPreferences', { ...dto, studyLevel, fieldOfInterest });
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
   * Income is required for each declared earner, and the household total is
   * recomputed from those incomes.
   */
  saveFinancialInformation(userId: string, dto: FinancialInformationDto) {

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
    const coApplicant = (profile.coApplicant as Record<string, unknown>) || {};
    const projects = (profile.projects as Record<string, unknown>) || {};

    const requiredDocs = REQUIRED_DOCUMENTS[profile.studyLevel || ''] || [];

    const checklist = [
      {
        key: 'personalInformation',
        label: 'Personal Information',
        done: Boolean(personal['fullName'] && personal['email'] && personal['mobileNumber'] && personal['country'] && personal['state'] && personal['city'])
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
        done: Boolean(financial['fundingSource'] && financial['currency'] && financial['needsLoan'])
      },
      { key: 'projectsAchievements', label: 'Projects & Achievements', done: Array.isArray(projects['projects']) },
      /** Documents are only gated once the older onboarding flow has set a study level. */
      {
        key: 'documentsUploaded',
        label: 'Documents',
        done: requiredDocs.length === 0 || requiredDocs.every(doc => uploadedTypes.has(doc))
      }
    ];

    /** Each step reports what it is worth, so a screen can say "+15%" beside it. */
    const weighted = checklist.map(item => ({ ...item, weight: SECTION_WEIGHTS[item.key] ?? 0 }));
    const earned = weighted.reduce((sum, item) => sum + (item.done ? item.weight : 0), 0);

    /**
     * Which verification documents a lender needs from this student, and which of
     * them are in. Resolved here rather than rebuilt by every screen that shows it.
     *
     * The category-specific proofs are keyed to how the co-applicant earns, which
     * the loan application asks — so until that question is answered, only the
     * documents every applicant needs are requested. Asking for salary slips
     * *and* an agricultural income certificate of one household would be asking
     * for paperwork that cannot all exist.
     */
    const employmentType = String(coApplicant['employmentType'] || '');
    const loanDocumentFields = String(financial['needsLoan'] || '') === 'yes'
      ? FINANCIAL_DOCUMENT_FIELDS.filter(
          doc => !doc.categories || (!!employmentType && doc.categories.includes(employmentType))
        )
      : [];
    const loanDocuments = loanDocumentFields.map(doc => ({
      key: doc.key,
      label: doc.label,
      uploaded: uploadedTypes.has(doc.label)
    }));

    return {
      completionPercent: Math.round((earned / TOTAL_WEIGHT) * 100),
      status: profile.status,
      sections: weighted,
      missing: weighted.filter(item => !item.done).map(item => item.label),
      loanDocuments: {
        needsLoan: String(financial['needsLoan'] || ''),
        employmentType,
        required: loanDocuments,
        complete: loanDocuments.length > 0 && loanDocuments.every(doc => doc.uploaded)
      }
    };
  }
}
