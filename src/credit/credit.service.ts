import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptField, encryptField, isEncrypted, isIndividualPan, isPanFormat, maskPan } from '../common/field-crypto';
import { StubBureauProvider } from './stub-bureau.provider';
import {
  BAND_FRESH_DAYS,
  CONSENT_VALID_DAYS,
  CreditCheckKind,
  CreditSubject
} from './credit.types';

const days = (n: number) => n * 24 * 60 * 60 * 1000;

/**
 * The co-applicant's answers, and the credit look-ups they authorise.
 *
 * Two rules run through everything here. A PAN is written encrypted and read
 * back masked — the only place it appears in full is on its way to the bureau.
 * And no look-up happens without a consent that names who may look, why, and
 * until when; the attempt is recorded either way, because a bureau contract asks
 * who tried, not only who succeeded.
 */
@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  constructor(private prisma: PrismaService, private bureau: StubBureauProvider) {}

  // ── The co-applicant ──────────────────────────────────────────────────────

  /**
   * Stores the co-applicant, encrypting the PAN on the way in.
   *
   * A PAN whose fourth character is not `P` belongs to a company or a trust
   * rather than a person, and cannot stand as co-applicant — worth catching here
   * rather than letting the bureau reject it after the student has moved on.
   */
  async saveCoApplicant(userId: string, input: Record<string, unknown>) {
    const pan = String(input.panNumber || '').trim().toUpperCase();

    if (pan && !isPanFormat(pan)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Enter a PAN in the form ABCDE1234F' });
    }
    if (pan && !isIndividualPan(pan)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'That PAN belongs to a company or trust. A co-applicant has to be a person.'
      });
    }

    const profile = await this.prisma.studentProfile.upsert({
      where: { userId },
      create: { userId },
      update: {}
    });
    const current = (profile.coApplicant as Record<string, unknown>) || {};

    const stored: Record<string, unknown> = { ...current, ...input };
    if (pan) {
      stored.panNumber = encryptField(pan);
      /** Kept so the student recognises which card they entered without a decrypt. */
      stored.panMasked = maskPan(pan);
    }

    /** The annual figure the rest of the product reads is derived, never entered twice. */
    const monthly = Number(stored.monthlyIncome) || 0;
    stored.annualIncome = monthly * 12;

    await this.prisma.studentProfile.update({
      where: { userId },
      data: { coApplicant: stored as never }
    });

    return this.readCoApplicant(userId);
  }

  /** The co-applicant as anyone outside this service may see them: PAN masked. */
  async readCoApplicant(userId: string): Promise<Record<string, unknown> | null> {
    const profile = await this.prisma.studentProfile.findUnique({ where: { userId } });
    const stored = (profile?.coApplicant as Record<string, unknown>) || {};
    if (!Object.keys(stored).length) return null;

    const { panNumber, ...rest } = stored;
    void panNumber;
    return { ...rest, panNumber: stored.panMasked || '' };
  }

  /** The full identity, for the one moment it is sent to a bureau. */
  private async subjectFor(userId: string): Promise<CreditSubject> {
    const profile = await this.prisma.studentProfile.findUnique({ where: { userId } });
    const stored = (profile?.coApplicant as Record<string, unknown>) || {};

    const pan = String(stored.panNumber || '');
    if (!pan) {
      throw new BadRequestException({
        code: 'NO_CO_APPLICANT',
        message: 'Add a parent or guardian with their PAN before running a credit check'
      });
    }

    return {
      name: String(stored.name || ''),
      pan: isEncrypted(pan) ? decryptField(pan) : pan,
      dateOfBirth: String(stored.dateOfBirth || ''),
      mobileNumber: String(stored.mobileNumber || '')
    };
  }

  // ── Consent ───────────────────────────────────────────────────────────────

  /**
   * Records permission to look, in the words the person was shown.
   *
   * The statement is kept verbatim rather than referenced, so changing the
   * wording later never rewrites what somebody actually agreed to.
   */
  async grantConsent(
    studentUserId: string,
    input: { kind: CreditCheckKind; organizationId?: string; purpose: string; statement: string; ip?: string }
  ) {
    if (input.kind === 'LENDER_PULL' && !input.organizationId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A lender check has to name the lender it is for'
      });
    }

    return this.prisma.creditConsent.create({
      data: {
        studentUserId,
        organizationId: input.kind === 'LENDER_PULL' ? input.organizationId : null,
        kind: input.kind,
        purpose: input.purpose,
        statement: input.statement,
        expiresAt: new Date(Date.now() + days(CONSENT_VALID_DAYS)),
        grantedIp: input.ip
      }
    });
  }

  async revokeConsent(studentUserId: string, consentId: string) {
    const consent = await this.prisma.creditConsent.findFirst({ where: { id: consentId, studentUserId } });
    if (!consent) throw new NotFoundException({ code: 'CONSENT_NOT_FOUND', message: 'No such consent' });

    return this.prisma.creditConsent.update({
      where: { id: consentId },
      data: { revokedAt: new Date() }
    });
  }

  /** Every consent this student has given, with the live ones marked. */
  async consentsFor(studentUserId: string) {
    const now = new Date();
    const rows = await this.prisma.creditConsent.findMany({
      where: { studentUserId },
      orderBy: { grantedAt: 'desc' }
    });

    return rows.map(row => ({
      ...row,
      live: !row.revokedAt && row.expiresAt > now
    }));
  }

  /** The consent that permits this look-up, or null when there is none. */
  private async liveConsent(studentUserId: string, kind: CreditCheckKind, organizationId?: string) {
    return this.prisma.creditConsent.findFirst({
      where: {
        studentUserId,
        kind,
        organizationId: kind === 'LENDER_PULL' ? organizationId : null,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { grantedAt: 'desc' }
    });
  }

  // ── The look-up ───────────────────────────────────────────────────────────

  /**
   * Runs a credit check, if something permits it.
   *
   * A refusal is recorded as carefully as a success: the audit answers "who
   * tried to look at this person", which is the question a bureau contract and a
   * regulator both ask.
   */
  async runCheck(
    studentUserId: string,
    kind: CreditCheckKind,
    options: { organizationId?: string; actorUserId?: string } = {}
  ) {
    const audit = (result: string, detail?: string, consentId?: string) =>
      this.prisma.bureauPullAudit.create({
        data: {
          studentUserId,
          organizationId: options.organizationId,
          actorUserId: options.actorUserId,
          consentId,
          kind,
          provider: this.bureau.name,
          result,
          detail
        }
      });

    const consent = await this.liveConsent(studentUserId, kind, options.organizationId);
    if (!consent) {
      await audit('DENIED_NO_CONSENT', 'No live consent covers this look-up');
      throw new BadRequestException({
        code: 'NO_CONSENT',
        message: 'The parent or guardian has not agreed to a credit check for this'
      });
    }

    /**
     * A recent band is reused rather than pulled again. It saves the fee, and
     * for a lender it saves the co-applicant a second hard enquiry they gain
     * nothing from.
     */
    const existing = await this.prisma.creditCheck.findFirst({
      where: {
        studentUserId,
        kind,
        organizationId: options.organizationId ?? null,
        staleAfter: { gt: new Date() },
        outcome: 'SCORED'
      },
      orderBy: { pulledAt: 'desc' }
    });
    if (existing) {
      await audit('OK', 'Reused a band that is still current', consent.id);
      return { ...existing, reused: true };
    }

    const subject = await this.subjectFor(studentUserId);

    let membership: { memberId: string; secretRef: string } | undefined;
    if (kind === 'LENDER_PULL' && options.organizationId) {
      const credential = await this.prisma.organizationBureauCredential.findUnique({
        where: { organizationId: options.organizationId }
      });
      if (!credential || credential.status !== 'ACTIVE') {
        await audit('DENIED_NO_CREDENTIAL', 'The lender has no active bureau membership configured', consent.id);
        throw new BadRequestException({
          code: 'NO_BUREAU_CREDENTIAL',
          message: 'This lender has no active credit bureau membership configured'
        });
      }
      if (credential.validUntil && credential.validUntil < new Date()) {
        await audit('DENIED_EXPIRED_CREDENTIAL', 'The bureau certificate has expired', consent.id);
        throw new BadRequestException({
          code: 'BUREAU_CREDENTIAL_EXPIRED',
          message: 'This lender\'s credit bureau certificate has expired'
        });
      }
      membership = { memberId: credential.memberId, secretRef: credential.secretRef };
    }

    const result = await this.bureau.pull({ subject, kind, membership });

    const check = await this.prisma.creditCheck.create({
      data: {
        consentId: consent.id,
        studentUserId,
        organizationId: options.organizationId ?? null,
        kind,
        enquiry: result.enquiry,
        band: result.band ?? null,
        outcome: result.outcome,
        providerRef: result.providerRef ?? null,
        provider: result.provider,
        staleAfter: new Date(Date.now() + days(BAND_FRESH_DAYS))
      }
    });

    await audit(result.outcome === 'SCORED' ? 'OK' : result.outcome, result.detail, consent.id);
    return { ...check, reused: false };
  }

  /** The most recent look-up a given reader is entitled to see. */
  async latestCheck(studentUserId: string, organizationId?: string) {
    return this.prisma.creditCheck.findFirst({
      where: {
        studentUserId,
        /** A lender sees its own pull; anyone else sees the self-pull band. */
        ...(organizationId ? { OR: [{ organizationId }, { kind: 'SELF_PULL' }] } : { kind: 'SELF_PULL' })
      },
      orderBy: { pulledAt: 'desc' }
    });
  }
}
