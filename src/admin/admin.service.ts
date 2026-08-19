import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStatus, OrganizationType } from '@prisma/client';
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

  async auditLog(limit?: number) {
    const entries = await this.prisma.auditLog.findMany({
      orderBy: { occurredAt: 'desc' },
      take: Math.min(Math.max(Number(limit) || 100, 1), 500)
    });
    return { entries };
  }
}
