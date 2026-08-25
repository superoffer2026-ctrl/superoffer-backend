import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStatus, OrganizationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const APPROVAL_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED']);
const ORG_TYPES = new Set(['UNIVERSITY', 'BANK', 'CONSULTANCY']);

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async listRegistrations(status = 'PENDING', orgType = 'ALL') {
    const normalizedStatus = String(status || 'PENDING').toUpperCase();
    const normalizedOrgType = String(orgType || 'ALL').toUpperCase();
    if (normalizedStatus !== 'ALL' && !APPROVAL_STATUSES.has(normalizedStatus)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'status must be PENDING, APPROVED, REJECTED, or ALL' });
    }
    if (normalizedOrgType !== 'ALL' && !ORG_TYPES.has(normalizedOrgType)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'org_type must be UNIVERSITY, BANK, CONSULTANCY, or ALL' });
    }

    const users = await this.prisma.user.findMany({
      where: {
        organizationId: { not: null },
        organization: {
          ...(normalizedStatus !== 'ALL' ? { verificationStatus: normalizedStatus as ApprovalStatus } : {}),
          ...(normalizedOrgType !== 'ALL' ? { organizationType: normalizedOrgType as OrganizationType } : {})
        }
      },
      include: { organization: true },
      orderBy: { createdAt: 'desc' }
    });

    const registrations = users.map(user => ({
      user_id: user.id,
      full_name: user.fullName || '',
      email: user.email || '',
      phone: user.phone || '',
      role: user.role,
      approval_status: user.organization?.verificationStatus,
      organization: user.organization
        ? {
            name: user.organization.name,
            organizationType: user.organization.organizationType,
            registrationNumber: user.organization.registrationNumber,
            licenseReference: user.organization.licenseReference,
            website: user.organization.website,
            country: user.organization.country,
            city: user.organization.city
          }
        : null,
      submitted_at: user.organization?.submittedAt || user.createdAt,
      reviewed_at: user.organization?.reviewedAt || null,
      rejection_reason: user.organization?.rejectionReason || null
    }));

    // The metric tiles always summarize every org regardless of the active
    // filter, so switching status/org_type tabs doesn't make counts jump.
    const allOrgs = await this.prisma.organization.findMany();
    const summary = {
      pending: allOrgs.filter(org => org.verificationStatus === 'PENDING').length,
      approved: allOrgs.filter(org => org.verificationStatus === 'APPROVED').length,
      rejected: allOrgs.filter(org => org.verificationStatus === 'REJECTED').length,
      universities: allOrgs.filter(org => org.organizationType === 'UNIVERSITY' && org.verificationStatus === 'PENDING').length,
      banks: allOrgs.filter(org => org.organizationType === 'BANK' && org.verificationStatus === 'PENDING').length,
      consultancies: allOrgs.filter(org => org.organizationType === 'CONSULTANCY' && org.verificationStatus === 'PENDING').length
    };

    return { registrations, summary };
  }

  async reviewRegistration(userId: string, approvalStatus: string, rejectionReason?: string, approvalNote?: string) {
    const normalized = String(approvalStatus || '').toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(normalized)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'approval_status must be APPROVED or REJECTED' });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { organization: true } });
    if (!user || !user.organization) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Registration was not found' });
    }

    const organization = await this.prisma.organization.update({
      where: { id: user.organization.id },
      data: {
        verificationStatus: normalized as ApprovalStatus,
        reviewedAt: new Date(),
        rejectionReason: normalized === 'REJECTED' ? rejectionReason || 'The submitted organization details could not be verified' : null,
        reviewNote: normalized === 'APPROVED' ? approvalNote || null : null
      }
    });

    await this.prisma.auditLog.create({
      data: {
        action: normalized === 'APPROVED' ? 'ORGANIZATION_APPROVED' : 'ORGANIZATION_REJECTED',
        organizationName: organization.name,
        entityId: organization.id,
        actorUserId: 'SUPER_ADMIN',
        reason: normalized === 'REJECTED' ? organization.rejectionReason : organization.reviewNote
      }
    });

    return {
      user_id: user.id,
      approval_status: organization.verificationStatus,
      can_login: organization.verificationStatus === 'APPROVED',
      reviewed_at: organization.reviewedAt
    };
  }

  /** Platform totals for the admin dashboard — all counted from the database. */
  async stats() {
    const [students, organizations, offers, submittedProfiles] = await Promise.all([
      this.prisma.user.count({ where: { role: 'STUDENT' } }),
      this.prisma.organization.findMany({ select: { organizationType: true, verificationStatus: true, plan: true } }),
      this.prisma.offer.findMany({ select: { status: true } }),
      this.prisma.studentProfile.count({ where: { status: 'SUBMITTED' } })
    ]);

    const verified = (type: OrganizationType) =>
      organizations.filter(org => org.organizationType === type && org.verificationStatus === 'APPROVED').length;

    const officers = await this.prisma.user.groupBy({ by: ['role'], _count: { role: true } });
    const roleCount = (role: string) => officers.find(entry => entry.role === role)?._count.role ?? 0;

    const accepted = offers.filter(offer => offer.status === 'ACCEPTED').length;
    const planCount = (plan: string) => organizations.filter(org => org.plan === plan).length;

    return {
      students,
      submittedProfiles,
      universities: verified('UNIVERSITY'),
      banks: verified('BANK'),
      consultancies: verified('CONSULTANCY'),
      pendingVerifications: organizations.filter(org => org.verificationStatus === 'PENDING').length,
      invitationVolume: offers.length,
      acceptanceRate: offers.length ? Math.round((accepted / offers.length) * 100) : 0,
      roleBreakdown: [
        { label: 'Students', count: students },
        { label: 'University officers', count: roleCount('UNIVERSITY_OFFICER') },
        { label: 'Loan officers', count: roleCount('LOAN_OFFICER') }
      ],
      subscription: {
        tiers: ['Basic', 'Professional', 'Enterprise'].map(name => ({ name, orgs: planCount(name) }))
      },
      recentSubmissions: await this.recentSubmissions()
    };
  }

  private async recentSubmissions() {
    const organizations = await this.prisma.organization.findMany({
      orderBy: { submittedAt: 'desc' },
      take: 4,
      select: { id: true, name: true, organizationType: true, submittedAt: true, verificationStatus: true }
    });
    const label: Record<string, string> = { UNIVERSITY: 'University', BANK: 'Education lender', CONSULTANCY: 'Consultancy' };
    return organizations.map(org => ({
      id: org.id,
      initial: org.name.charAt(0).toUpperCase(),
      name: org.name,
      type: label[org.organizationType] || org.organizationType,
      submittedAt: org.submittedAt,
      status: org.verificationStatus === 'APPROVED' ? 'Verified' : org.verificationStatus === 'REJECTED' ? 'Rejected' : 'Pending'
    }));
  }

  /**
   * Authentication attempts, filtered, sorted and paginated server-side so the
   * panel renders exactly what it is given.
   */
  async authLogs(query: {
    search?: string;
    role?: string;
    outcome?: string;
    sort?: string;
    direction?: string;
    page?: string;
    pageSize?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 10));

    const sortable = ['occurredAt', 'email', 'role', 'outcome'] as const;
    const sort = (sortable as readonly string[]).includes(query.sort || '') ? (query.sort as string) : 'occurredAt';
    const direction = query.direction === 'asc' ? 'asc' : 'desc';

    const where: Prisma.LoginEventWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.outcome ? { outcome: query.outcome.toUpperCase() } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' as const } },
              { ip: { contains: query.search } },
              { user: { fullName: { contains: query.search, mode: 'insensitive' as const } } }
            ]
          }
        : {})
    };

    const [total, rows] = await Promise.all([
      this.prisma.loginEvent.count({ where }),
      this.prisma.loginEvent.findMany({
        where,
        include: { user: { select: { fullName: true } } },
        orderBy: { [sort]: direction },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    return {
      rows: rows.map(row => ({
        id: row.id,
        userName: row.user?.fullName || 'Unknown',
        email: row.email,
        role: row.role || '—',
        outcome: row.outcome,
        ip: row.ip || '—',
        userAgent: row.userAgent || '—',
        occurredAt: row.occurredAt
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
  }

  /**
   * Message threads, for resolving a dispute between a student and an
   * organization. Reading one is itself recorded in the audit log, so there is a
   * trail of which admin looked at whose conversation.
   */
  async conversations(query: { search?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 10));

    const where: Prisma.OfferWhereInput = {
      messages: { some: {} },
      ...(query.search
        ? {
            OR: [
              { organization: { name: { contains: query.search, mode: 'insensitive' as const } } },
              { student: { fullName: { contains: query.search, mode: 'insensitive' as const } } },
              { student: { email: { contains: query.search, mode: 'insensitive' as const } } },
              { program: { contains: query.search, mode: 'insensitive' as const } }
            ]
          }
        : {})
    };

    const [total, offers] = await Promise.all([
      this.prisma.offer.count({ where }),
      this.prisma.offer.findMany({
        where,
        include: {
          organization: { select: { name: true, organizationType: true } },
          student: { select: { fullName: true, email: true } },
          messages: { orderBy: { sentAt: 'asc' } }
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    return {
      conversations: offers.map(offer => ({
        offerId: offer.id,
        organization: offer.organization.name,
        organizationType: offer.organization.organizationType,
        student: offer.student?.fullName || offer.student?.email || 'Student',
        studentEmail: offer.student?.email || '',
        program: offer.program,
        status: offer.status,
        messageCount: offer.messages.length,
        lastMessageAt: offer.messages[offer.messages.length - 1]?.sentAt || offer.createdAt,
        messages: offer.messages.map(message => ({
          id: message.id,
          from: message.sender,
          author: message.authorName,
          body: message.body,
          sentAt: message.sentAt,
          /** An admin reviewing a complaint has to know which lines a rule wrote. */
          automatic: message.automatic,
          ruleId: message.ruleId,
          attachment: message.storagePath ? { fileName: message.fileName, mimeType: message.mimeType, size: message.fileSize } : null
        }))
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
  }

  /** Records that an admin opened a specific thread. */
  async recordConversationAccess(offerId: string, actor: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { organization: { select: { name: true } } }
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'CONVERSATION_VIEWED',
        entityId: offerId,
        organizationName: offer?.organization.name,
        actorUserId: actor,
        reason: 'Support or dispute review'
      }
    });
    return { recorded: true };
  }

  async auditLog(limit?: number) {
    const entries = await this.prisma.auditLog.findMany({
      orderBy: { occurredAt: 'desc' },
      take: Math.min(Math.max(Number(limit) || 100, 1), 500)
    });
    return { entries };
  }
}
