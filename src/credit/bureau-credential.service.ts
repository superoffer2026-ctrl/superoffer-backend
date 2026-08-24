import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FileSecretStore } from './secret-store';

/**
 * A partner bank's own bureau membership.
 *
 * The certificate is written to the secret store and only a reference is kept in
 * the database, so nothing here — and nothing in a database backup — can be used
 * to pull a credit report in a bank's name.
 *
 * Reading one back is deliberately not exposed over HTTP at all. The only caller
 * that needs the material is the connector, on its way to the bureau.
 */
@Injectable()
export class BureauCredentialService {
  private readonly logger = new Logger(BureauCredentialService.name);

  constructor(private prisma: PrismaService, private secrets: FileSecretStore) {}

  /** What an admin may see: everything except the certificate itself. */
  async list() {
    const rows = await this.prisma.organizationBureauCredential.findMany({
      include: { organization: { select: { name: true, organizationType: true } } },
      orderBy: { updatedAt: 'desc' }
    });

    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return {
      credentials: rows.map(row => ({
        id: row.id,
        organizationId: row.organizationId,
        organization: row.organization.name,
        provider: row.provider,
        memberId: row.memberId,
        certFingerprint: row.certFingerprint,
        validFrom: row.validFrom,
        validUntil: row.validUntil,
        status: row.status,
        rotatedAt: row.rotatedAt,
        /** A certificate that lapses stops pulls with no obvious cause, so it is called out early. */
        expired: !!row.validUntil && row.validUntil < new Date(),
        expiringSoon: !!row.validUntil && row.validUntil >= new Date() && row.validUntil < soon
      }))
    };
  }

  /**
   * Stores or replaces a bank's membership.
   *
   * The certificate is fingerprinted before it is put away, so a rotation can be
   * confirmed later without reading the secret back out.
   */
  async upsert(input: {
    organizationId: string;
    provider: string;
    memberId: string;
    certificate: string;
    validFrom?: string;
    validUntil?: string;
  }) {
    const organization = await this.prisma.organization.findUnique({ where: { id: input.organizationId } });
    if (!organization) {
      throw new NotFoundException({ code: 'ORGANIZATION_NOT_FOUND', message: 'No such organisation' });
    }
    if (organization.organizationType !== 'BANK') {
      throw new BadRequestException({
        code: 'NOT_A_LENDER',
        message: 'Only an education lender pulls credit reports, so only a lender has a bureau membership'
      });
    }
    if (!input.certificate?.trim()) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'The certificate is required' });
    }
    if (!input.memberId?.trim()) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'The bureau member ID is required' });
    }

    const existing = await this.prisma.organizationBureauCredential.findUnique({
      where: { organizationId: input.organizationId }
    });

    /** A fresh reference every time, so a rotation cannot be undone by an old file. */
    const ref = FileSecretStore.reference();
    await this.secrets.put(ref, input.certificate);
    if (existing) await this.secrets.remove(existing.secretRef).catch(() => undefined);

    const fingerprint = crypto.createHash('sha256').update(input.certificate).digest('hex').slice(0, 32);

    const saved = await this.prisma.organizationBureauCredential.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        provider: input.provider || 'surepass',
        memberId: input.memberId.trim(),
        secretRef: ref,
        certFingerprint: fingerprint,
        validFrom: input.validFrom ? new Date(input.validFrom) : null,
        validUntil: input.validUntil ? new Date(input.validUntil) : null
      },
      update: {
        provider: input.provider || 'surepass',
        memberId: input.memberId.trim(),
        secretRef: ref,
        certFingerprint: fingerprint,
        validFrom: input.validFrom ? new Date(input.validFrom) : null,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        status: 'ACTIVE',
        rotatedAt: existing ? new Date() : null
      }
    });

    await this.prisma.auditLog.create({
      data: {
        action: existing ? 'BUREAU_CREDENTIAL_ROTATED' : 'BUREAU_CREDENTIAL_ADDED',
        entityId: saved.id,
        actorUserId: 'super-admin',
        reason: `${organization.name} · member ${saved.memberId}`
      }
    });
    this.logger.log(`${existing ? 'Rotated' : 'Stored'} bureau membership for ${organization.name}`);

    /** The reference is returned; the certificate never is. */
    const { secretRef, ...rest } = saved;
    void secretRef;
    return rest;
  }

  /** Switches a membership off without discarding the record of it. */
  async suspend(organizationId: string) {
    const existing = await this.prisma.organizationBureauCredential.findUnique({ where: { organizationId } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'No membership on file' });

    return this.prisma.organizationBureauCredential.update({
      where: { organizationId },
      data: { status: 'SUSPENDED' }
    });
  }

  /** Removes the certificate entirely, for a partner who has left. */
  async remove(organizationId: string) {
    const existing = await this.prisma.organizationBureauCredential.findUnique({ where: { organizationId } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'No membership on file' });

    await this.secrets.remove(existing.secretRef).catch(() => undefined);
    await this.prisma.organizationBureauCredential.delete({ where: { organizationId } });
    return { removed: true };
  }
}
