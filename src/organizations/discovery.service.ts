import { Injectable, NotFoundException } from '@nestjs/common';
import { Organization, OrganizationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assessEligibility } from '../credit/eligibility';
import { FINANCIAL_DOCUMENT_FIELDS } from '../reference/data/wizard.data';

/** Filters the organization workspace sends. Everything is optional. */
export interface StudentSearchFilters {
  course?: string;
  degree?: string;
  country?: string;
  intake?: string;
  cgpaMin?: string;
  englishTest?: string;
  englishScoreMin?: string;
  greMin?: string;
  gmatMin?: string;
  backlogsMax?: string;
  workExperienceMin?: string;
  scholarship?: string;
  familyIncomeMax?: string;
  requiredLoanMax?: string;
  offerStatus?: string;
  /** Bank-only: 'academicOnly' shows students without a university offer, 'offerAvailable' the reverse. */
  visibility?: string;
  search?: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹', USD: '$', GBP: '£', EUR: '€', CAD: 'C$', AUD: 'A$', AED: 'AED ', SGD: 'S$'
};

const CARD_PALETTE = ['#0f6f54', '#315d88', '#8a5b35', '#695392', '#9a4f63', '#2d6a4f', '#a34135', '#1c5a7a'];

const first = <T>(values: T[] | undefined): T | undefined => (Array.isArray(values) ? values[0] : undefined);
const num = (value: unknown): number => Number(String(value ?? '').replace(/[^0-9.]/g, '')) || 0;

type ProfileWithUser = Prisma.StudentProfileGetPayload<{ include: { user: true } }>;

/**
 * Turns a submitted student profile into the card the organization workspace renders.
 *
 * Every derived value (match score, household income, eligibility) is computed here
 * rather than accepted from a client — see docs/09-Business-Rules.md.
 */
/** The first of these that reads as a plain sum of money, else 0. */
const moneyIn = (...candidates: unknown[]): number => {
  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim();
    /** "40% tuition" is a share, not a sum - comparing it against rupees is meaningless. */
    if (!text || text.includes('%')) continue;
    const digits = text.replace(/[^0-9.]/g, '');
    const value = Number(digits);
    if (digits && Number.isFinite(value) && value > 0) return value;
  }
  return 0;
};

/** Bare digits from a field that should hold a number, else 0. */
const numberIn = (value: unknown): number => {
  const parsed = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Plain-English name for what an organisation of this kind is offering. */
const OFFER_KIND: Record<string, { kind: string; heading: string; blurb: string; best: string }> = {
  UNIVERSITY: {
    kind: 'ADMISSION',
    heading: 'Universities ready to offer',
    blurb: 'Admissions this student already holds',
    /** A percentage scholarship is shown at what that share of the tuition is worth. */
    best: 'BEST SCHOLARSHIP'
  },
  BANK: {
    kind: 'FUNDING',
    heading: 'Lenders ready to offer',
    blurb: 'Funding already on the table for this student',
    best: 'LARGEST LOAN'
  },
  CONSULTANCY: {
    kind: 'ADVISORY',
    heading: 'Consultancies engaged',
    blurb: 'Advisers already working with this student',
    best: 'HIGHEST OFFER'
  }
};

/**
 * Summarises the offers that came from the *other* side of the deal, grouped so
 * the workspace can render one panel without knowing who is looking.
 */
const counterpartyOf = (offers: Array<ReturnType<DiscoveryService['offerSummary']>>) => {
  const relevant = offers.filter(offer => offer.isCounterpart);
  const byKind = relevant[0] ? OFFER_KIND[relevant[0].organizationType] : undefined;
  const maxAmount = relevant.reduce((highest, offer) => Math.max(highest, offer.amount), 0);
  const maxShare = relevant.reduce((highest, offer) => Math.max(highest, offer.share), 0);
  /**
   * The headline figure, quoted in the sender's own words so its currency stays
   * theirs. A share of tuition is shown as a share; only a stated sum is shown
   * as a sum.
   */
  const best = maxAmount
    ? relevant.find(offer => offer.amount === maxAmount)
    : maxShare
      ? relevant.find(offer => offer.share === maxShare)
      : undefined;
  const bestLabel = !best ? '' : maxAmount ? best.value : `${maxShare}% of tuition`;

  return {
    kind: byKind?.kind || null,
    heading: byKind?.heading || 'Offers from partners',
    blurb: byKind?.blurb || '',
    count: relevant.length,
    /** Highest single sum offered, and who is offering it. */
    maxAmount,
    maxShare,
    maxAmountLabel: bestLabel,
    maxAmountCaption: byKind?.best || 'HIGHEST OFFER',
    maxAmountFrom: best?.organizationName || '',
    /** True once the student has said yes to one of them — the strongest signal there is. */
    anyAccepted: relevant.some(offer => offer.accepted),
    offers: relevant.map(offer => ({
      organization: offer.organizationName,
      organizationType: offer.organizationType,
      country: offer.country || '',
      program: offer.program,
      status: offer.status,
      accepted: offer.accepted,
      /** What they offered, in the sender's own words. */
      value: offer.value || offer.valueLabel || '—',
      amount: offer.amount,
      share: offer.share
    }))
  };
};

/** The household summary a lender sees before deciding whether to invite. */
export interface LoanReadiness {
  coApplicantRelationship: string;
  monthlyIncome: number;
  existingEmi: number;
  employmentType: string;
  /** A band, never a score. Absent when nothing has been checked. */
  creditBand: string | null;
  /** SCORED, NO_HISTORY, and so on — a thin file is not a bad one. */
  creditOutcome: string | null;
  checkedAt: Date | null;
  /** True once the band is old enough that a lender should not rely on it. */
  stale: boolean;
  documentsVerified: number;
  documentsExpected: number;
  verdict: string;
  affordableEmi: number;
  indicativeAmount: number;
  reasons: string[];
}

@Injectable()
export class DiscoveryService {
  constructor(private prisma: PrismaService) {}

  private project(
    profile: ProfileWithUser,
    offers: Array<ReturnType<DiscoveryService['offerSummary']>>,
    uploadedDocuments: string[] = [],
    readiness: LoanReadiness | null = null
  ) {
    const personal = (profile.personal as Record<string, string>) || {};
    const preferences = (profile.studyPreferences as Record<string, string[]>) || {};
    const academic = (profile.academic as Record<string, unknown>) || {};
    const exams = (profile.entranceExams as Record<string, unknown>) || {};
    const work = (profile.workExperience as Record<string, unknown>) || {};
    const financial = (profile.financial as Record<string, unknown>) || {};
    const projects = (profile.projects as Record<string, unknown>) || {};

    const name = personal['fullName'] || profile.user.fullName || 'Unnamed Student';
    const country = first(preferences['countries']) || personal['country'] || '';
    const course = first(preferences['fieldOfInterest']) || '';
    const programLevel = first(preferences['studyLevel']) || '';
    const degree = /bachelor|undergrad/i.test(programLevel) ? 'Undergraduate' : 'Postgraduate';

    const cgpa = String(academic['score'] || '');
    const englishExam = String(exams['englishExam'] || '');
    const englishScore = num(exams['englishScore']);
    const englishTest = /toefl/i.test(englishExam)
      ? 'TOEFL'
      : /det|duolingo/i.test(englishExam)
        ? 'Duolingo'
        : /pte/i.test(englishExam)
          ? 'PTE'
          : 'IELTS';

    const entranceExam = String(exams['entranceExam'] || '').toUpperCase();
    const entranceScore = num(exams['entranceScore']);

    const employed = work['workStatus'] === 'Yes';
    const workExperienceYears = employed ? num(work['relevantYears']) + num(work['nonRelevantYears']) : 0;

    const currency = String(financial['currency'] || 'INR');
    const householdIncome = num(financial['annualHouseholdIncome']);
    const symbol = CURRENCY_SYMBOLS[currency] || '';
    const fundingSource = String(financial['fundingSource'] || '');
    const employmentCategory = String(financial['employmentCategory'] || '');
    const needsLoan = String(financial['needsLoan'] || '');

    const history = (academic['history'] as Array<Record<string, string>>) || [];
    const highest = history[history.length - 1];

    const examParts = [
      englishExam && `${englishExam} ${exams['englishScore'] || ''}`.trim(),
      entranceExam && `${exams['entranceExam']} ${exams['entranceScore'] || ''}`.trim()
    ].filter(Boolean);

    /** Completeness of the fields organizations filter on, used as the match score. */
    const checklist = [
      personal['fullName'], personal['email'], personal['mobileNumber'], personal['country'], personal['city'],
      preferences['countries']?.length, preferences['fieldOfInterest']?.length, preferences['studyLevel']?.length,
      preferences['startYear']?.length, preferences['intake']?.length,
      academic['qualificationLevel'], academic['institution'], academic['score'], academic['graduationYear']
    ];
    const score = Math.round((checklist.filter(Boolean).length / checklist.length) * 100);

    const hash = Array.from(name).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);

    return {
      id: profile.userId,
      name,
      initials: name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase(),
      photo: '/intelligent-matching-students.png',
      course,
      country,
      degree,
      intake: first(preferences['intake']) || '',
      /** Every field the student picked, not just the first — the workspace shows this as "future study interests". */
      futureInterests: (preferences['fieldOfInterest'] || []).join(', '),
      email: personal['email'] || profile.user.email || '',
      mobile: personal['mobileNumber'] || profile.user.phone || '',
      currentCity: personal['city'] || '',
      originCountry: personal['country'] || '',
      cgpa,
      cgpaValue: num(cgpa),
      englishTest,
      englishScore,
      ielts: englishTest === 'IELTS' ? englishScore : 0,
      toefl: englishTest === 'TOEFL' ? englishScore : undefined,
      gre: entranceExam === 'GRE' ? entranceScore : undefined,
      gmat: entranceExam.startsWith('GMAT') ? entranceScore : undefined,
      backlogs: num(highest?.['backlogs']),
      workExperienceYears,
      /** Not collected anywhere in the wizard yet — see docs/10-Open-Decisions.md #10. */
      visaRefused: false,
      documentsVerified: uploadedDocuments.length,
      examScore: examParts.join(' · ') || 'Not recorded',
      budget: householdIncome ? `${symbol}${householdIncome.toLocaleString('en-IN')}` : 'Not shared',
      budgetValue: householdIncome,
      familyIncome: householdIncome || undefined,
      requiredLoanAmount: needsLoan === 'yes' ? householdIncome : 0,
      financialSummary: fundingSource
        ? `${fundingSource} · Household income ${currency} ${householdIncome.toLocaleString('en-IN')}`
        : 'Financial details not shared',
      skills: ((projects['achievements'] as string[]) || []).slice(0, 8),
      score,
      factor: 'Recently submitted',
      scholarshipSeeking: fundingSource === 'Scholarship' || fundingSource === 'Combination of the Above',
      bio: [academic['qualification'], academic['institution'] && `graduate from ${academic['institution']}`, course && `pursuing ${course}`]
        .filter(Boolean)
        .join(', ') || 'Recently submitted student profile.',
      color: CARD_PALETTE[hash % CARD_PALETTE.length],
      eligible: true,
      eligibilityNote: 'Manual review pending — recently submitted profile.',
      live: true as const,
      submittedAt: profile.submittedAt?.toISOString() || profile.updatedAt.toISOString(),
      needsLoan,
      employmentCategory,
      financialDocuments:
        needsLoan === 'yes'
          ? FINANCIAL_DOCUMENT_FIELDS.filter(doc => !doc.categories || !employmentCategory || doc.categories.includes(employmentCategory)).map(
              doc => ({ key: doc.key, label: doc.label, uploaded: uploadedDocuments.includes(doc.label) })
            )
          : undefined,
      /**
       * What the other side of the deal has already put on the table. A lender
       * sees the admissions this student holds; a university sees the funding
       * behind them. Same-kind offers are deliberately absent — see offerSummary.
       */
      counterparty: counterpartyOf(offers),
      /**
       * Whether this household could carry a loan. Present only for lenders, and
       * only once the co-applicant has agreed to a check — a university has no
       * business reading a parent's credit standing, and neither does a lender
       * the family has not opened the door to.
       */
      loanReadiness: readiness,
      universityInterests: offers.map(offer => ({
        university: offer.organizationName,
        country: offer.country || '',
        course: offer.program,
        status: offer.status,
        scholarship: offer.terms['scholarshipPct'] ? `${offer.terms['scholarshipPct']}% tuition` : offer.value || '—',
        tuitionFee: String(offer.terms['tuitionFee'] || ''),
        livingCost: String(offer.terms['livingCost'] || '')
      }))
    };
  }

  /**
   * Only SUBMITTED profiles are discoverable. Filtering happens in memory because
   * the profile lives in JSON columns; move the hot filters into SQL (or a
   * projection table) if the student count outgrows a single page of results.
   */
  async search(organization: Organization, filters: StudentSearchFilters) {
    const profiles = await this.prisma.studentProfile.findMany({
      /** A student is visible only once submitted, and only while their own
       *  discovery toggle is on. */
      /* Alumni are already admitted, so they are nobody's candidate. */
      where: { status: 'SUBMITTED', discoverable: true, segment: { not: 'ALUMNI' } },
      include: { user: true },
      orderBy: { submittedAt: 'desc' }
    });

    const offers = await this.prisma.offer.findMany({
      where: { studentUserId: { in: profiles.map(profile => profile.userId) }, status: { notIn: ['WITHDRAWN', 'EXPIRED'] } },
      include: { organization: true }
    });

    const offersByStudent = new Map<string, ReturnType<DiscoveryService['offerSummary']>[]>();
    for (const offer of offers) {
      const list = offersByStudent.get(offer.studentUserId) || [];
      list.push(this.offerSummary(offer, organization));
      offersByStudent.set(offer.studentUserId, list);
    }

    const documentsByStudent = await this.documentsByStudent(profiles.map(profile => profile.userId));

    /** One query per student only for a lender; nobody else can see this block. */
    const students = await Promise.all(
      profiles.map(async profile => {
        const documents = documentsByStudent.get(profile.userId) || [];
        return this.project(
          profile,
          offersByStudent.get(profile.userId) || [],
          documents,
          await this.loanReadinessFor(organization, profile, documents)
        );
      })
    );
    const results = students.filter(student => this.matches(student, filters, organization));

    return { results, total_results: results.length };
  }

  private async documentsByStudent(studentUserIds: string[]) {
    const documents = await this.prisma.studentDocument.findMany({
      where: { userId: { in: studentUserIds } },
      select: { userId: true, documentType: true }
    });
    const byStudent = new Map<string, string[]>();
    for (const document of documents) {
      const list = byStudent.get(document.userId) || [];
      list.push(document.documentType);
      byStudent.set(document.userId, list);
    }
    return byStudent;
  }

  /**
   * A competing university must not see what another university offered the same
   * student. Banks and consultancies do need those economics to size a loan or
   * advise, so only university-to-university terms are withheld.
   */
  offerSummary(offer: Prisma.OfferGetPayload<{ include: { organization: true } }>, viewer: Organization) {
    const isOwn = offer.organizationId === viewer.id;
    /**
     * A rival is an organisation of the same kind. The other side of the deal is
     * not: a lender needs to know the student holds an admission before it can
     * price a loan, and a university needs to know the funding is secured before
     * it counts on the seat. Two universities bidding for the same student have
     * no such claim on each other's numbers, and neither do two lenders.
     */
    const isCounterpart = offer.organization.organizationType !== viewer.organizationType;
    const maySeeTerms = isOwn || isCounterpart;
    const terms = ((offer.terms as Record<string, unknown>) || {});

    return {
      organizationName: offer.organization.name,
      organizationType: offer.organization.organizationType,
      country: offer.organization.country,
      program: offer.program,
      status: offer.status === 'ACCEPTED' ? 'Admitted' : offer.status === 'NEGOTIATING' ? 'Selected' : 'Offer Sent',
      accepted: offer.studentDecision === 'ACCEPTED',
      isOwn,
      isCounterpart,
      terms: maySeeTerms ? terms : {},
      value: maySeeTerms ? offer.value || '' : '',
      valueLabel: maySeeTerms ? offer.valueLabel || '' : '',
      /** A stated sum, when the offer names one. */
      amount: maySeeTerms ? moneyIn(terms['loanAmount'], terms['scholarshipAmount'], offer.value) : 0,
      /**
       * A scholarship quoted as a share of tuition. It is deliberately not turned
       * into a sum: tuition is free text like "CAD 42,000 / year", so any figure
       * derived from it would carry the wrong currency and the wrong period.
       */
      share: maySeeTerms ? numberIn(terms['scholarshipPct']) : 0
    };
  }

  private matches(
    student: ReturnType<DiscoveryService['project']>,
    filters: StudentSearchFilters,
    organization: Organization
  ): boolean {
    const atLeast = (value: number, min?: string) => !min || value >= Number(min);
    const atMost = (value: number, max?: string) => !max || value <= Number(max);
    const hasOffer = (student.universityInterests?.length || 0) > 0;

    /** Bank-only: the evaluation mode decides which students an officer may see at all. */
    const mode = organization.bankEvaluationMode || 'ACADEMIC_AND_OFFER';
    if (organization.organizationType === 'BANK') {
      if (mode === 'UNIVERSITY_OFFER_ONLY' && !hasOffer) return false;
      if (mode === 'ACADEMIC_ONLY' && hasOffer) return false;
    }
    if (organization.organizationType === 'BANK' && filters.visibility) {
      if (filters.visibility === 'academicOnly' && hasOffer) return false;
      if (filters.visibility === 'offerAvailable' && !hasOffer) return false;
    }

    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!`${student.name} ${student.course} ${student.country}`.toLowerCase().includes(q)) return false;
    }

    return (
      (!filters.course || student.course === filters.course) &&
      (!filters.degree || student.degree === filters.degree) &&
      (!filters.country || student.country === filters.country) &&
      (!filters.intake || student.intake === filters.intake) &&
      (!filters.englishTest || student.englishTest === filters.englishTest) &&
      (!filters.scholarship || (filters.scholarship === 'yes' ? student.scholarshipSeeking : !student.scholarshipSeeking)) &&
      (!filters.offerStatus || (student.universityInterests || []).some(offer => offer.status === filters.offerStatus)) &&
      atLeast(student.cgpaValue, filters.cgpaMin) &&
      atLeast(student.englishScore, filters.englishScoreMin) &&
      atLeast(student.gre ?? 0, filters.greMin) &&
      atLeast(student.gmat ?? 0, filters.gmatMin) &&
      atLeast(student.workExperienceYears, filters.workExperienceMin) &&
      atMost(student.backlogs, filters.backlogsMax) &&
      atMost(student.familyIncome ?? 0, filters.familyIncomeMax) &&
      atMost(student.requiredLoanAmount ?? 0, filters.requiredLoanMax)
    );
  }

  /**
   * The household summary, or null when the reader has no business seeing it.
   *
   * Two gates, both of which have to be open: the reader is a lender, and the
   * co-applicant has agreed to a check. A university never sees this, and a
   * lender sees nothing until the family has opened the door.
   */
  private async loanReadinessFor(
    organization: Organization,
    profile: ProfileWithUser,
    uploadedDocuments: string[]
  ): Promise<LoanReadiness | null> {
    if (organization.organizationType !== 'BANK') return null;

    const coApplicant = (profile.coApplicant as Record<string, unknown>) || {};
    if (!Object.keys(coApplicant).length) return null;

    const consent = await this.prisma.creditConsent.findFirst({
      where: { studentUserId: profile.userId, kind: 'SELF_PULL', revokedAt: null, expiresAt: { gt: new Date() } }
    });
    if (!consent) return null;

    const check = await this.prisma.creditCheck.findFirst({
      where: { studentUserId: profile.userId, kind: 'SELF_PULL' },
      orderBy: { pulledAt: 'desc' }
    });

    const monthlyIncome = num(coApplicant['monthlyIncome']);
    const existingEmi = num(coApplicant['existingEmi']);
    const employmentType = String(coApplicant['employmentType'] || '');

    const expected = FINANCIAL_DOCUMENT_FIELDS.filter(
      doc => !doc.categories || !employmentType || doc.categories.includes(employmentType)
    );

    const eligibility = assessEligibility({
      monthlyIncome,
      existingEmi,
      employmentType,
      band: check?.band,
      outcome: check?.outcome
    });

    return {
      coApplicantRelationship: String(coApplicant['relationship'] || ''),
      monthlyIncome,
      existingEmi,
      employmentType,
      creditBand: check?.band ?? null,
      creditOutcome: check?.outcome ?? null,
      checkedAt: check?.pulledAt ?? null,
      stale: !!check && check.staleAfter < new Date(),
      documentsVerified: expected.filter(doc => uploadedDocuments.includes(doc.label)).length,
      documentsExpected: expected.length,
      verdict: eligibility.verdict,
      affordableEmi: eligibility.affordableEmi,
      indicativeAmount: eligibility.indicativeAmount,
      reasons: eligibility.reasons
    };
  }

  async findOne(organization: Organization, studentUserId: string) {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId: studentUserId },
      include: { user: true }
    });
    if (!profile || profile.status !== 'SUBMITTED' || !profile.discoverable || profile.segment === 'ALUMNI') {
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'No discoverable student found for that id' });
    }
    const offers = await this.prisma.offer.findMany({
      where: { studentUserId, status: { notIn: ['WITHDRAWN', 'EXPIRED'] } },
      include: { organization: true }
    });
    const documents = await this.documentsByStudent([studentUserId]);
    const uploaded = documents.get(studentUserId) || [];
    return this.project(
      profile,
      offers.map(offer => this.offerSummary(offer, organization)),
      uploaded,
      await this.loanReadinessFor(organization, profile, uploaded)
    );
  }
}
