import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Institution officers can't discover students or send offers until a Super Admin
 * has approved their organization (docs/09-Business-Rules.md).
 *
 * On success the resolved organization is attached to the request as
 * `request.organization` so controllers don't have to look it up again.
 */
@Injectable()
export class ApprovedOrganizationGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  /** The one thing a suspended organisation may still read: its own bill. */
  private isBillingRoute(request: { url?: string }): boolean {
    return (request.url || '').includes('/organizations/me/billing');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    if (!userId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Authentication is required' });

    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { organization: true } });
    if (!user?.organization) {
      throw new ForbiddenException({ code: 'NO_ORGANIZATION', message: 'This account is not linked to an organization' });
    }
    if (user.organization.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException({
        code: 'ORGANIZATION_NOT_APPROVED',
        message: 'Your organization is still being reviewed by the SuperOffer admin team',
        approval_status: user.organization.verificationStatus
      });
    }

    /**
     * A suspension is an admin's decision, never an automatic consequence of an
     * unpaid invoice — but once taken it has to bite, or it is only a label.
     * Billing itself stays reachable, so a suspended customer can still see what
     * they owe and what to pay; everything else is closed.
     */
    if (user.organization.suspendedAt && !this.isBillingRoute(request)) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_SUSPENDED',
        message:
          user.organization.suspensionReason ||
          'Your organisation account is suspended. Please contact the SuperOffer team.'
      });
    }

    request.organization = user.organization;
    return true;
  }
}
