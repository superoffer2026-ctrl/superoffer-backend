import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { availabilityFieldFor, availabilityFrom } from '../offers/marketplace-availability';

/**
 * Following up the students who accepted an offer, and removing their data
 * once the admission is confirmed.
 *
 * The point of the section is that a student who is already at a university
 * should stop being recommended to universities and lenders. That happens in
 * two steps, deliberately kept apart:
 *
 *  - confirming an admission stops discovery immediately, and is reversible;
 *  - purging erases the personal data, and is not.
 *
 * Purging *redacts* rather than deletes. `Offer.student` cascades, so deleting
 * the account would take every offer that student ever received with it —
 * including the university's own record of the admission we just confirmed,
 * and our own proof that the offer existed. The person disappears; the fact
 * that an offer was made and accepted stays.
 */
@Injectable()
export class AdmissionsService {
  private readonly logger = new Logger(AdmissionsService.name);

  constructor(private prisma: PrismaService) {}

  /** Everyone who has accepted an offer, with whatever the team has recorded. */
  async list(status?: string) {
    const offers = await this.prisma.offer.findMany({
      where: { studentDecision: 'ACCEPTED' },
      orderBy: { updatedAt: 'desc' },
      include: {
        organization: { select: { id: true, name: true, organizationType: true, country: true } },
        student: {
          select: {
            id: true, fullName: true, email: true, phone: true, status: true,
            studentProfile: { select: { segment: true, alumniSince: true } }
          }
        },
        admissionFollowUp: true
      }
    });

    const rows = offers.map(offer => {
      const followUp = offer.admissionFollowUp;
      return {
        offerId: offer.id,
        acceptedAt: offer.updatedAt,
        program: offer.program,
        headline: offer.headline,
        value: offer.value,
        valueLabel: offer.valueLabel,
        intake: offer.intake,
        organization: offer.organization,
        student: {
          id: offer.student?.id ?? null,
          /** A purged student has no name left to show; say so rather than blank. */
          name: followUp?.purgedAt ? 'Data removed' : offer.student?.fullName ?? null,
          email: followUp?.purgedAt ? null : offer.student?.email ?? null,
          phone: followUp?.purgedAt ? null : offer.student?.phone ?? null
        },
        segment: offer.student?.studentProfile?.segment ?? 'STUDENT',
        alumniSince: offer.student?.studentProfile?.alumniSince ?? null,
        status: followUp?.status ?? 'PENDING',
        note: followUp?.note ?? null,
        checkedBy: followUp?.checkedBy ?? null,
        confirmedAt: followUp?.confirmedAt ?? null,
        purgedAt: followUp?.purgedAt ?? null
      };
    });

    const filtered = status && status !== 'all'
      ? rows.filter(row => (status === 'purged' ? !!row.purgedAt : row.status === status && !row.purgedAt))
      : rows;

    return {
      admissions: filtered,
      counts: {
        all: rows.length,
        PENDING: rows.filter(row => row.status === 'PENDING' && !row.purgedAt).length,
        CONFIRMED: rows.filter(row => row.status === 'CONFIRMED' && !row.purgedAt).length,
        NOT_ADMITTED: rows.filter(row => row.status === 'NOT_ADMITTED' && !row.purgedAt).length,
        purged: rows.filter(row => !!row.purgedAt).length
      }
    };
  }

  /**
   * Everything the team needs to check one admission: what was offered, and
   * who the student is. A purged record keeps the offer and drops the person.
   */
  async detail(offerId: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: {
        organization: true,
        student: { include: { studentProfile: true } },
        admissionFollowUp: true,
        messages: { orderBy: { sentAt: 'asc' }, take: 50 }
      }
    });
    if (!offer) throw new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'No such offer' });
    if (offer.studentDecision !== 'ACCEPTED') {
      throw new BadRequestException({
        code: 'NOT_ACCEPTED',
        message: 'This offer has not been accepted, so there is no admission to follow up.'
      });
    }

    const purged = !!offer.admissionFollowUp?.purgedAt;
    const profile = offer.student?.studentProfile;
    const documents = purged
      ? []
      : await this.prisma.studentDocument.findMany({
          where: { userId: offer.studentUserId },
          select: { id: true, documentType: true, fileName: true, uploadedAt: true }
        });

    return {
      offerId: offer.id,
      acceptedAt: offer.updatedAt,
      offer: {
        headline: offer.headline,
        program: offer.program,
        value: offer.value,
        valueLabel: offer.valueLabel,
        intake: offer.intake,
        conditions: offer.conditions,
        nextSteps: offer.nextSteps,
        contactName: offer.contactName,
        contactRole: offer.contactRole,
        expiresAt: offer.expiresAt,
        status: offer.status
      },
      organization: {
        id: offer.organization.id,
        name: offer.organization.name,
        type: offer.organization.organizationType,
        country: offer.organization.country,
        city: offer.organization.city,
        website: offer.organization.website,
        registrationNumber: offer.organization.registrationNumber
      },
      student: purged
        ? { purged: true }
        : {
            purged: false,
            id: offer.student?.id,
            name: offer.student?.fullName,
            email: offer.student?.email,
            phone: offer.student?.phone,
            personal: profile?.personal ?? {},
            studyPreferences: profile?.studyPreferences ?? {},
            academic: profile?.academic ?? {},
            financial: profile?.financial ?? {},
            discoverable: profile?.discoverable ?? false,
            segment: profile?.segment ?? 'STUDENT',
            alumniSince: profile?.alumniSince ?? null,
            documents
          },
      thread: offer.messages.map(message => ({
        sender: message.sender,
        authorName: message.authorName,
        body: message.body,
        sentAt: message.sentAt
      })),
      followUp: offer.admissionFollowUp ?? { status: 'PENDING', note: null, purgedAt: null }
    };
  }

  /**
   * Recording what the team found.
   *
   * Confirming stops discovery straight away — that is the whole business
   * reason for the section, and it should not wait on somebody remembering to
   * purge. It is also reversible: setting the outcome back to PENDING or
   * NOT_ADMITTED puts the student back in front of organisations.
   */
  async record(offerId: string, input: { status?: string; note?: string; checkedBy?: string }) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { admissionFollowUp: true }
    });
    if (!offer) throw new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'No such offer' });
    if (offer.admissionFollowUp?.purgedAt) {
      throw new BadRequestException({
        code: 'ALREADY_PURGED',
        message: 'This student\'s data has been removed; the record cannot be changed.'
      });
    }

    const status = input.status || 'PENDING';
    if (!['PENDING', 'CONFIRMED', 'NOT_ADMITTED'].includes(status)) {
      throw new BadRequestException({ code: 'BAD_STATUS', message: 'Unknown follow-up outcome' });
    }

    const followUp = await this.prisma.admissionFollowUp.upsert({
      where: { offerId },
      create: {
        offerId,
        status,
        note: input.note ?? null,
        checkedBy: input.checkedBy ?? null,
        confirmedAt: status === 'CONFIRMED' ? new Date() : null
      },
      update: {
        status,
        note: input.note ?? null,
        checkedBy: input.checkedBy ?? null,
        confirmedAt: status === 'CONFIRMED' ? (offer.admissionFollowUp?.confirmedAt ?? new Date()) : null
      }
    });

    /*
     * A confirmed admission moves the student into the alumni segment.
     *
     * They keep their account and everything in it — they may come back for a
     * postgraduate place or a loan — they simply stop being put in front of
     * universities and lenders, because they already have what those offers
     * were for. Reversible in one field if the university turns out to be
     * wrong, which is the whole reason this is a segment and not a deletion.
     */
    const alumni = status === 'CONFIRMED';
    /**
     * NOT_ADMITTED returns them to the market this offer belonged to, and only
     * that one: a student who did not get the place still needs one, but their
     * funding arrangements are untouched by the news.
     */
    if (status === 'NOT_ADMITTED') {
      const field = availabilityFieldFor(offer.category);
      if (field) {
        const offers = await this.prisma.offer.findMany({
          where: { studentUserId: offer.studentUserId },
          select: { category: true, studentDecision: true, status: true }
        });
        await this.prisma.studentProfile.updateMany({
          where: { userId: offer.studentUserId },
          data: { [field]: availabilityFrom(offers, field) }
        });
      }
    }

    await this.prisma.studentProfile.updateMany({
      where: { userId: offer.studentUserId },
      data: alumni
        ? { segment: 'ALUMNI', alumniSince: new Date(), alumniOfferId: offerId, discoverable: false }
        : { segment: 'STUDENT', alumniSince: null, alumniOfferId: null, discoverable: true }
    });

    await this.prisma.auditLog.create({
      data: {
        action: `ADMISSION_${status}`,
        organizationName: (await this.prisma.organization.findUnique({
          where: { id: offer.organizationId },
          select: { name: true }
        }))?.name,
        entityId: offerId,
        actorUserId: input.checkedBy ?? null,
        reason: input.note ?? null
      }
    });

    return followUp;
  }

  /**
   * Removing the student, keeping the admission.
   *
   * Only after the admission is confirmed: purging on an unverified acceptance
   * would destroy a real student's account on the strength of a claim nobody
   * checked. Everything personal goes — profile sections, contact details,
   * uploaded files on disk, credit consents, and the shortlists that would
   * otherwise keep them in front of officers. The offer, the organisation and
   * the fact of the admission remain.
   */
  async purge(offerId: string, actor?: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { admissionFollowUp: true, organization: { select: { name: true } } }
    });
    if (!offer) throw new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'No such offer' });

    const followUp = offer.admissionFollowUp;
    if (!followUp || followUp.status !== 'CONFIRMED') {
      throw new BadRequestException({
        code: 'NOT_CONFIRMED',
        message: 'Confirm the admission before removing the student\'s data.'
      });
    }
    if (followUp.purgedAt) {
      throw new BadRequestException({ code: 'ALREADY_PURGED', message: 'This data has already been removed.' });
    }

    const userId = offer.studentUserId;

    /*
     * The thread carries their name in plain text.
     *
     * Automation renders {{student.firstName}} and {{student.name}} into the
     * body when a message is sent, so emptying the profile does not touch what
     * was already written — and the organisation that made the offer can still
     * read the whole conversation. Anything the student typed themselves may
     * hold far more than a name.
     */
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true, phone: true, studentProfile: { select: { personal: true } } }
    });
    const personal = (account?.studentProfile?.personal ?? {}) as Record<string, string>;
    const fullName = (personal.fullName || account?.fullName || '').trim();
    /** Longest first, so a full name is replaced before its first word is. */
    const identifiers = [
      fullName,
      fullName.split(/\s+/)[0],
      personal.email,
      account?.email,
      personal.mobileNumber,
      account?.phone
    ]
      .filter((value): value is string => !!value && value.trim().length > 2)
      .sort((a, b) => b.length - a.length);

    /*
     * Whole words only, and marked as a redaction rather than reworded.
     *
     * A plain substring replace turned "MSc Probe" into "MSc the student" for a
     * student whose first name was Probe — mangling the organisation's own
     * record of what it offered. Word boundaries stop the mid-word case; the
     * marker makes what is left obviously redacted rather than quietly wrong.
     *
     * A first name that happens to be a whole word in the programme title is
     * still over-redacted. That is the safer way round: over-redacting costs a
     * word of context, under-redacting leaves a name we promised to remove.
     */
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const scrub = (text: string) =>
      identifiers.reduce(
        (carry, value) => carry.replace(new RegExp(`\\b${escape(value)}\\b`, 'gi'), '[removed]'),
        text || ''
      );

    const thread = await this.prisma.offerMessage.findMany({
      where: { offerId },
      select: { id: true, sender: true, body: true, authorName: true }
    });

    /* Files first: a row deleted without its file leaves the file forever. */
    const documents = await this.prisma.studentDocument.findMany({
      where: { userId },
      select: { id: true, storagePath: true }
    });
    for (const document of documents) {
      if (document.storagePath) await unlink(document.storagePath).catch(() => undefined);
    }

    const marker = randomUUID();
    await this.prisma.$transaction([
      /*
       * What the student wrote goes entirely — there is no way to know what is
       * in it. What was written *to* them keeps its meaning with their name
       * taken out, so the organisation still has a usable record of the offer
       * it made.
       */
      ...thread.map(message =>
        this.prisma.offerMessage.update({
          where: { id: message.id },
          data: message.sender === 'student'
            ? { body: 'Message removed with the student\'s data.', authorName: 'Data removed' }
            : { body: scrub(message.body), authorName: scrub(message.authorName) }
        })
      ),
      this.prisma.studentDocument.deleteMany({ where: { userId } }),
      this.prisma.shortlist.deleteMany({ where: { studentUserId: userId } }),
      this.prisma.creditConsent.deleteMany({ where: { studentUserId: userId } }),
      /* Every section emptied, including the co-applicant's encrypted PAN. */
      this.prisma.studentProfile.updateMany({
        where: { userId },
        data: {
          personal: {}, studyPreferences: {}, academic: {}, entranceExams: {},
          workExperience: {}, financial: {}, coApplicant: {}, projects: {},
          basic: {}, preferences: {}, testDetails: {}, achievements: {}, links: {},
          selectedTests: [], settings: {},
          discoverable: false,
          status: 'PURGED'
        }
      }),
      /*
       * The account is kept so the offer's foreign key survives, but nothing
       * about the person does. The WhatsApp number is a student's identity, so
       * it is made unusable rather than null — releasing it would let the same
       * number be re-registered and silently inherit this history. The marker
       * can never match PHONE_PATTERN, so no sign-in or OTP lookup can reach it.
       */
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: null,
          phone: `purged.${marker}`,
          fullName: 'Data removed',
          passwordHash: null,
          status: 'DELETED',
          emailVerifiedAt: null,
          phoneVerifiedAt: null
        }
      }),
      this.prisma.authSession.deleteMany({ where: { userId } }),
      this.prisma.admissionFollowUp.update({
        where: { offerId },
        data: { purgedAt: new Date(), purgedBy: actor ?? null }
      }),
      this.prisma.auditLog.create({
        data: {
          action: 'ADMISSION_DATA_PURGED',
          organizationName: offer.organization.name,
          entityId: offerId,
          actorUserId: actor ?? null,
          reason: `Admission confirmed; ${documents.length} document(s) and ${thread.length} message(s) redacted`
        }
      })
    ]);

    this.logger.log(`Purged student data for offer ${offerId} (${documents.length} documents)`);
    return { purged: true, documentsRemoved: documents.length };
  }
}
