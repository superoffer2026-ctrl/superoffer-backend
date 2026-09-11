import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Organization, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { LocalMediaStorage } from '../media/media.storage';
import { OrganizationProfileDto, ProductDto, TeamInviteDto } from './dto/organization.dto';

const SHORTLIST_STATUSES = ['SHORTLISTED', 'REJECTED'];

/** Quota per subscription tier. Enterprise is unmetered. */
const DEFAULT_NOTIFICATION_PREFS = [
  { key: 'invitation_status', label: 'Invitation status changes', detail: 'Viewed, negotiated, accepted, rejected, expired', frequency: 'Instant' },
  { key: 'quota', label: 'Quota alerts', detail: 'When your subscription quota is nearing its limit', frequency: 'Instant' },
  { key: 'verification', label: 'Verification status', detail: "Changes to your organisation's verification status", frequency: 'Instant' }
];

/** The two term sets every new organization starts with, by type. */
const DEFAULT_OFFER_TEMPLATES: Record<string, unknown[]> = {
  UNIVERSITY: [
    {
      id: 'tpl-merit',
      name: '40% Merit Scholarship',
      description: 'Standard scholarship offer for high-CGPA applicants.',
      terms: { scholarship: '40% tuition scholarship', tuition: '', accommodation: 'Campus residence available' },
      usedCount: 0
    },
    {
      id: 'tpl-fast-track',
      name: 'Fast-track, no scholarship',
      description: 'For applicants past scholarship deadlines who still qualify for admission.',
      terms: { scholarship: '', tuition: '', accommodation: 'Off-campus support' },
      usedCount: 0
    }
  ],
  BANK: [
    {
      id: 'tpl-preapproved',
      name: 'Pre-approved standard rate',
      description: 'Academic-profile pre-approval before admission is confirmed.',
      terms: { offerType: 'PreApproved', loanAmount: '', interestRate: '', processingFee: '1%', tenure: '', conditions: 'Subject to admission confirmation' },
      usedCount: 0
    },
    {
      id: 'tpl-guarantor',
      name: 'Guarantor-conditional low rate',
      description: 'Lower rate contingent on a verified guarantor.',
      terms: { offerType: 'Final', loanAmount: '', interestRate: '', processingFee: 'Waived', tenure: '', conditions: 'Subject to guarantor verification' },
      usedCount: 0
    }
  ],
  CONSULTANCY: []
};

const DEFAULT_CRITERIA: Record<string, Record<string, unknown>> = {
  UNIVERSITY: { minCgpa: 7.5, minEnglishScore: 6.5, englishTest: 'IELTS', preferredCurricula: 'STEM, Business', targetCountries: 'Canada, United Kingdom' },
  BANK: { guarantorRequired: true, maxFamilyIncome: 2000000, eligibleCountries: 'Canada, United Kingdom, Australia' },
  CONSULTANCY: {}
};

/**
 * Everything the organization workspace used to keep in localStorage: the product
 * catalog, the shortlist, the team, matching criteria, notification preferences
 * and the subscription tier.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
    private media: LocalMediaStorage
  ) {}

  /** The workspace loads this once and renders from it — no client-side defaults. */
  async profile(organization: Organization) {
    const prefs = organization.notificationPrefs as unknown[];
    const templates = organization.offerTemplates as unknown[];
    const criteria = organization.criteria as Record<string, unknown>;

    return {
      id: organization.id,
      name: organization.name,
      organizationType: organization.organizationType,
      registrationNumber: organization.registrationNumber,
      licenseReference: organization.licenseReference,
      website: organization.website,
      country: organization.country,
      city: organization.city,
      description: organization.description,
      /** Resolved to URLs here; the stored reference never leaves the server. */
      logoUrl: this.media.urlFor(organization.logoRef),
      coverUrl: this.media.urlFor(organization.coverRef),
      verificationStatus: organization.verificationStatus,
      reviewedAt: organization.reviewedAt,
      bankEvaluationMode: organization.bankEvaluationMode || 'ACADEMIC_AND_OFFER',
      criteria: Object.keys(criteria).length ? criteria : DEFAULT_CRITERIA[organization.organizationType] || {},
      notificationPrefs: prefs.length ? prefs : DEFAULT_NOTIFICATION_PREFS,
      offerTemplates: templates.length ? templates : DEFAULT_OFFER_TEMPLATES[organization.organizationType] || [],
      /** Whatever the active subscription grants, and what is left of it. */
      subscription: await this.billing.entitlement(organization)
    };
  }

  /**
   * An organisation edits its own profile — but not what it is entitled to.
   *
   * `plan` used to be accepted here, which meant a university could put itself on
   * Enterprise from its own settings screen and take unlimited profile views
   * without anyone selling them anything. Plans are sold offline now, so only an
   * admin recording a subscription can change one.
   */
  async updateProfile(organization: Organization, dto: OrganizationProfileDto) {
    if (dto.plan !== undefined) {
      throw new BadRequestException({
        code: 'PLAN_NOT_SELF_SERVICE',
        message: 'Subscription plans are arranged with the SuperOffer team, not changed here.'
      });
    }
    const updated = await this.prisma.organization.update({
      where: { id: organization.id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.description === undefined ? {} : { description: dto.description }),
        ...(dto.city === undefined ? {} : { city: dto.city }),
        ...(dto.website === undefined ? {} : { website: dto.website }),
        ...(dto.bankEvaluationMode === undefined ? {} : { bankEvaluationMode: dto.bankEvaluationMode }),
        ...(dto.criteria === undefined ? {} : { criteria: dto.criteria as Prisma.InputJsonValue }),
        ...(dto.notificationPrefs === undefined ? {} : { notificationPrefs: dto.notificationPrefs as Prisma.InputJsonValue }),
        ...(dto.offerTemplates === undefined ? {} : { offerTemplates: dto.offerTemplates as Prisma.InputJsonValue })
      }
    });
    return this.profile(updated);
  }

  // ── Product catalog ───────────────────────────────────────────────────────

  async listProducts(organizationId: string) {
    const rows = await this.prisma.organizationProduct.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { createdAt: 'asc' }
    });
    /** Fees leave as decimal strings and images as URLs; the row's own shapes stay internal. */
    return rows.map(row => ({
      ...row,
      tuitionFee: row.tuitionFeeMinor === null ? null : (row.tuitionFeeMinor / 100).toFixed(2),
      imageUrl: this.media.urlFor(row.imageRef)
    }));
  }

  /** The academic columns, from whole units to the minor units actually stored. */
  private programColumns(dto: ProductDto) {
    return {
      ...(dto.degreeLevel === undefined ? {} : { degreeLevel: dto.degreeLevel || null }),
      ...(dto.fieldOfStudy === undefined ? {} : { fieldOfStudy: dto.fieldOfStudy || null }),
      ...(dto.durationMonths === undefined ? {} : { durationMonths: dto.durationMonths ?? null }),
      ...(dto.studyMode === undefined ? {} : { studyMode: dto.studyMode || null }),
      ...(dto.campusLocation === undefined ? {} : { campusLocation: dto.campusLocation || null }),
      ...(dto.intakes === undefined ? {} : { intakes: dto.intakes }),
      ...(dto.tuitionFee === undefined ? {} : { tuitionFeeMinor: dto.tuitionFee === null ? null : Math.round(dto.tuitionFee * 100) }),
      ...(dto.currency === undefined ? {} : { currency: dto.currency || null }),
      ...(dto.scholarshipInfo === undefined ? {} : { scholarshipInfo: dto.scholarshipInfo || null })
    };
  }

  createProduct(organizationId: string, dto: ProductDto) {
    return this.prisma.organizationProduct.create({
      data: {
        organizationId,
        name: dto.name,
        category: dto.category,
        url: dto.url,
        ...this.programColumns(dto),
        terms: (dto.terms || {}) as Prisma.InputJsonValue
      }
    });
  }

  async updateProduct(organizationId: string, id: string, dto: ProductDto) {
    await this.assertOwnedProduct(organizationId, id);
    return this.prisma.organizationProduct.update({
      where: { id },
      data: {
        name: dto.name,
        category: dto.category,
        url: dto.url,
        ...this.programColumns(dto),
        ...(dto.terms === undefined ? {} : { terms: dto.terms as Prisma.InputJsonValue })
      }
    });
  }

  /** One image per programme, replacing whatever was there. */
  async setProductImage(organizationId: string, id: string, ref: string) {
    const existing = await this.assertOwnedProduct(organizationId, id);
    await this.media.remove(existing.imageRef);
    return this.prisma.organizationProduct.update({ where: { id }, data: { imageRef: ref } });
  }

  /** The organisation's own logo and cover, uploaded by the organisation itself. */
  async setOrganizationImage(organizationId: string, field: 'logoRef' | 'coverRef', ref: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    await this.media.remove(organization[field]);
    return this.prisma.organization.update({ where: { id: organizationId }, data: { [field]: ref } });
  }

  /** Archived rather than deleted, so offers that reference a product keep their history. */
  async archiveProduct(organizationId: string, id: string) {
    await this.assertOwnedProduct(organizationId, id);
    await this.prisma.organizationProduct.update({ where: { id }, data: { archivedAt: new Date() } });
    return { id, archived: true };
  }

  /** Bulk create from the workspace's CSV import. */
  async importProducts(organizationId: string, products: ProductDto[]) {
    if (!products.length) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'No valid rows found in the file' });
    }
    await this.prisma.organizationProduct.createMany({
      data: products.map(product => ({
        organizationId,
        name: product.name,
        category: product.category,
        url: product.url,
        terms: (product.terms || {}) as Prisma.InputJsonValue
      }))
    });
    return { imported: products.length, products: await this.listProducts(organizationId) };
  }

  private async assertOwnedProduct(organizationId: string, id: string) {
    const product = await this.prisma.organizationProduct.findUnique({ where: { id } });
    if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    if (product.organizationId !== organizationId) throw new ForbiddenException();
    return product;
  }

  // ── Shortlist ─────────────────────────────────────────────────────────────

  async listShortlist(organizationId: string) {
    const entries = await this.prisma.shortlist.findMany({
      where: { organizationId },
      select: { studentUserId: true, status: true }
    });
    return {
      entries,
      studentUserIds: entries.filter(entry => entry.status === 'SHORTLISTED').map(entry => entry.studentUserId),
      rejectedUserIds: entries.filter(entry => entry.status === 'REJECTED').map(entry => entry.studentUserId)
    };
  }

  /** `status` records the officer's triage: a shortlist entry or an explicit rejection. */
  async addToShortlist(organizationId: string, studentUserId: string, status = 'SHORTLISTED') {
    if (!SHORTLIST_STATUSES.includes(status)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown shortlist status' });
    }
    const student = await this.prisma.user.findUnique({ where: { id: studentUserId }, select: { role: true } });
    if (!student || student.role !== 'STUDENT') {
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'No student found for that id' });
    }
    await this.prisma.shortlist.upsert({
      where: { organizationId_studentUserId: { organizationId, studentUserId } },
      create: { organizationId, studentUserId, status },
      update: { status }
    });
    return this.listShortlist(organizationId);
  }

  async removeFromShortlist(organizationId: string, studentUserId: string) {
    await this.prisma.shortlist.deleteMany({ where: { organizationId, studentUserId } });
    return this.listShortlist(organizationId);
  }

  // ── Team ──────────────────────────────────────────────────────────────────

  async listTeam(organizationId: string, currentUserId: string) {
    const members = await this.prisma.user.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fullName: true, email: true, role: true, lastLoginAt: true, status: true }
    });

    const roleLabel: Record<string, string> = {
      UNIVERSITY_OFFICER: 'Admissions Officer',
      LOAN_OFFICER: 'Loan Manager',
      CONSULTANT: 'Consultant'
    };

    return members.map(member => ({
      id: member.id,
      name: member.fullName || member.email || 'Officer',
      email: member.email || '',
      role: roleLabel[member.role] || member.role,
      initials: (member.fullName || member.email || '?')
        .split(/[\s@.]+/)
        .filter(Boolean)
        .map(part => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
      /** An officer who has never signed in is still working through their invite. */
      status: member.lastLoginAt ? 'Active' : 'Invited',
      isSelf: member.id === currentUserId
    }));
  }

  /**
   * Invites an officer into the organization. They inherit the inviter's role and
   * the organization's approval, so they can sign in as soon as they set a password.
   */
  async inviteOfficer(organization: Organization, inviterRole: string, dto: TeamInviteDto, currentUserId: string) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new BadRequestException({ code: 'EMAIL_ALREADY_REGISTERED', message: 'An account already exists for this email' });
    }
    /** A random secret they cannot use — the invite flow will set a real password. */
    const placeholder = await bcrypt.hash(`invite-${Date.now()}-${Math.random()}`, 12);

    await this.prisma.user.create({
      data: {
        email,
        fullName: dto.name,
        role: inviterRole as never,
        organizationId: organization.id,
        passwordHash: placeholder
      }
    });
    return this.listTeam(organization.id, currentUserId);
  }

  async removeOfficer(organizationId: string, memberId: string, currentUserId: string) {
    if (memberId === currentUserId) {
      throw new BadRequestException({ code: 'CANNOT_REMOVE_SELF', message: 'You cannot remove your own account' });
    }
    const member = await this.prisma.user.findUnique({ where: { id: memberId }, select: { organizationId: true } });
    if (!member || member.organizationId !== organizationId) throw new ForbiddenException();

    await this.prisma.user.delete({ where: { id: memberId } });
    return this.listTeam(organizationId, currentUserId);
  }
}
