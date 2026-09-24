import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationVerificationDto } from './dto/verification.dto';

/** Free mailboxes prove nothing about belonging to an institution. */
const PUBLIC_MAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com',
  'hotmail.com', 'live.com', 'icloud.com', 'proton.me', 'protonmail.com',
  'rediffmail.com', 'aol.com', 'zoho.com', 'mail.com', 'yandex.com'
];

const hostOf = (value: string) =>
  (value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

/**
 * What a reviewer needs before an approval means anything.
 *
 * Named per field rather than checked as a block, because "your submission is
 * incomplete" sends a registrar hunting and "the accreditation reference is
 * missing" does not.
 */
const REQUIRED: Array<{ key: string; asks: string }> = [
  { key: 'country', asks: 'the country' },
  { key: 'city', asks: 'the city' }
];

@Injectable()
export class VerificationService {
  constructor(private prisma: PrismaService) {}

  private async organizationOf(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { organization: true } });
    if (!user?.organization) {
      throw new NotFoundException({ code: 'NO_ORGANIZATION', message: 'This account is not linked to an organisation' });
    }
    return { user, organization: user.organization };
  }

  /** What is missing, in the words the page shows. */
  private outstanding(organization: Record<string, unknown>) {
    return REQUIRED.filter(field => !String(organization[field.key] ?? '').trim()).map(field => field.asks);
  }

  async status(userId: string) {
    const { user, organization } = await this.organizationOf(userId);
    const record = organization as unknown as Record<string, unknown>;
    const missing = this.outstanding(record);

    const emailDomain = hostOf((user.email || '').split('@')[1] || '');
    const siteDomain = hostOf(String(record.website ?? ''));

    return {
      organization: {
        name: organization.name,
        organizationType: organization.organizationType,
        registrationNumber: organization.registrationNumber,
        licenseReference: organization.licenseReference,
        website: organization.website,
        country: organization.country,
        city: organization.city,
        description: organization.description
      },
      approval_status: organization.verificationStatus,
      rejection_reason: organization.rejectionReason,
      reviewed_at: organization.reviewedAt,
      submitted_at: organization.submittedAt,
      /** Empty means it can be sent for review. */
      missing,
      complete: missing.length === 0,
      /**
       * Not a blocker — a registrar may legitimately be using a personal
       * address — but the reviewer sees it, so the organisation should know
       * it will be asked about.
       */
      notes: [
        emailDomain && PUBLIC_MAIL_DOMAINS.includes(emailDomain)
          ? `Your sign-in address is on ${emailDomain}. A reviewer will look for an address on your own domain.`
          : '',
        emailDomain && siteDomain && !PUBLIC_MAIL_DOMAINS.includes(emailDomain)
          && !emailDomain.endsWith(siteDomain) && !siteDomain.endsWith(emailDomain)
          ? `Your sign-in address is on ${emailDomain} but your website is ${siteDomain}.`
          : ''
      ].filter(Boolean)
    };
  }

  async save(userId: string, input: OrganizationVerificationDto) {
    const { organization } = await this.organizationOf(userId);

    if (organization.verificationStatus === 'APPROVED') {
      throw new ForbiddenException({
        code: 'ALREADY_APPROVED',
        message: 'This organisation is already verified. Contact support to change these details.'
      });
    }

    /** Only what was sent is written, so saving one field does not blank the rest. */
    const data: Record<string, string> = {};
    for (const key of ['registrationNumber', 'licenseReference', 'website', 'country', 'city', 'description'] as const) {
      const value = input[key];
      if (typeof value === 'string') data[key] = value.trim();
    }

    const saved = await this.prisma.organization.update({
      where: { id: organization.id },
      data
    });

    if (input.submit) {
      const missing = this.outstanding(saved as unknown as Record<string, unknown>);
      if (missing.length) {
        throw new BadRequestException({
          code: 'VERIFICATION_INCOMPLETE',
          message: `Still needed before a review: ${missing.join(', ')}.`,
          missing
        });
      }
      /**
       * Re-submitting after a rejection puts it back in the queue and clears
       * the old reason, which no longer describes what was sent.
       */
      await this.prisma.organization.update({
        where: { id: organization.id },
        data: { verificationStatus: 'PENDING', rejectionReason: null, submittedAt: new Date() }
      });
    }

    return this.status(userId);
  }
}
