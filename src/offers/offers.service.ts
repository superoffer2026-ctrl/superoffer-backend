import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OfferCategory, OfferStatus, Organization, Prisma, StudentDecision } from '@prisma/client';
import { AutomationService } from '../automation/automation.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOfferDto, OfferFlagsDto } from './dto/offer.dto';

/** Standard response window when the sender doesn't set one (docs/06-Offers-Module.md). */
const DEFAULT_RESPONSE_WINDOW_DAYS = 14;

/** Once an offer reaches one of these, nothing may change it again. */
import { LocalMediaStorage } from '../media/media.storage';

const TERMINAL_STATUSES: OfferStatus[] = ['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'];

const DECISION_TO_STATUS: Record<string, OfferStatus> = {
  Accepted: 'ACCEPTED',
  Rejected: 'REJECTED'
};

const DEFAULT_CATEGORY_BY_ORG_TYPE: Record<string, OfferCategory> = {
  UNIVERSITY: 'UNIVERSITY',
  BANK: 'BANK',
  CONSULTANCY: 'CONSULTANCY'
};

/**
 * What each kind of organisation is allowed to send.
 *
 * A university offers a place and may attach a scholarship to it; a bank offers
 * money. Neither can send the other's, and the category is not a free choice
 * from the client — it decides which market the student leaves when they accept,
 * so a university sending a BANK offer would close their funding rather than
 * their admission, and hide them from the wrong half of the platform.
 */
const CATEGORIES_BY_ORG_TYPE: Record<string, OfferCategory[]> = {
  UNIVERSITY: ['UNIVERSITY', 'SCHOLARSHIP'],
  BANK: ['BANK'],
  CONSULTANCY: ['CONSULTANCY']
};

/** A file arriving with a message, already written to disk by the interceptor. */
export interface MessageAttachment {
  originalname: string;
  path: string;
  mimetype: string;
  size: number;
}

const attachmentData = (attachment?: MessageAttachment) =>
  attachment
    ? { fileName: attachment.originalname, storagePath: attachment.path, mimeType: attachment.mimetype, fileSize: attachment.size }
    : {};

/** Messages from the other side that arrived after this side last looked. */
/**
 * Whether a reader should see a message.
 *
 * Human messages are always shared. Automated ones carry the audience their rule
 * was written for, so a notice meant for the officer is not shown to the student
 * who triggered it.
 *
 * The exception matters: a message sent *in someone's name* is always visible to
 * them. An officer must be able to read the auto-reply that went out under their
 * own name, or a student thanking them for it makes no sense.
 */
const visibleTo = (
  message: { automatic?: boolean; audience?: string | null; sender: string },
  reader: 'student' | 'organization'
) => {
  if (!message.automatic) return true;
  if (reader === 'organization' && message.sender === 'institution') return true;
  if (reader === 'student' && message.sender === 'student') return true;
  return !message.audience || message.audience === 'both' || message.audience === reader;
};

const countUnread = (
  messages: Array<{ sender: string; sentAt: Date }>,
  fromSender: string,
  readAt: Date | null
) => messages.filter(message => message.sender === fromSender && (!readAt || message.sentAt > readAt)).length;

type OfferWithRelations = Prisma.OfferGetPayload<{
  include: { organization: true; messages: true };
}>;

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();

@Injectable()
export class OffersService {
  constructor(
    private prisma: PrismaService,
    private automation: AutomationService,
    private media: LocalMediaStorage
  ) {}

  /**
   * Serialises an offer into exactly the shape the student wallet renders, so the
   * frontend needs no mapping layer. `terms` is spread last because its keys are
   * the category-specific comparison fields.
   */
  private toStudentOffer(offer: OfferWithRelations) {
    const expired = offer.status === 'EXPIRED' || offer.expiresAt.getTime() < Date.now();
    let decision = expired && offer.studentDecision === 'PENDING' ? 'Pending' : this.decisionLabel(offer.studentDecision);
    if (offer.status === 'WITHDRAWN') decision = 'Withdrawn';

    return {
      id: offer.id,
      category: this.categoryLabel(offer.category),
      institution: offer.organization.name,
      initial: initialsOf(offer.organization.name),
      institutionWebsite: offer.organization.website || '',
      /**
       * The university and programme as they were when this was sent, not as they
       * are now. Everything a student needs to compare one offer against another
       * without opening a prospectus.
       */
      snapshot: (offer.programSnapshot as Record<string, unknown>) || {},
      institutionDescription: offer.organization.description || '',
      program: offer.program,
      headline: offer.headline,
      description: offer.description || '',
      received: offer.createdAt.toISOString(),
      status: decision,
      location: offer.location || [offer.organization.city, offer.organization.country].filter(Boolean).join(', '),
      intake: offer.intake || '',
      deadline: offer.expiresAt.toISOString(),
      valueLabel: offer.valueLabel || '',
      value: offer.value || '',
      conditions: offer.conditions || '',
      nextSteps: offer.nextSteps,
      contact: offer.contactName || '',
      contactRole: offer.contactRole || '',
      messages: offer.messages
        .filter(message => visibleTo(message, 'student'))
        .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
        .map(message => ({
          id: message.id,
          from: message.sender as 'institution' | 'student' | 'system',
          author: message.authorName,
          body: message.body,
          /** Lets the UI say a message was automated rather than typed. */
          automatic: message.automatic,
          time: message.sentAt.toISOString(),
          attachment: message.storagePath
            ? { fileName: message.fileName || 'attachment', mimeType: message.mimeType || '', size: message.fileSize || 0 }
            : null
        })),
      unread: countUnread(offer.messages, 'institution', offer.studentReadAt),
      viewed: Boolean(offer.viewedAt),
      compared: offer.compared,
      saved: offer.savedByStudent,
      favourite: offer.favourite,
      expired,
      ...(offer.terms as Record<string, unknown>)
    };
  }

  /** The organization's view keeps the lifecycle vocabulary rather than the student's. */
  private toOrganizationOffer(offer: OfferWithRelations & { student?: { fullName: string | null } | null }) {
    return {
      id: offer.id,
      studentUserId: offer.studentUserId,
      studentName: offer.student?.fullName || 'Student',
      category: this.categoryLabel(offer.category),
      program: offer.program,
      headline: offer.headline,
      status: this.statusLabel(offer.status),
      studentDecision: this.decisionLabel(offer.studentDecision),
      terms: offer.terms,
      location: offer.location || '',
      intake: offer.intake || '',
      valueLabel: offer.valueLabel || '',
      value: offer.value || '',
      nextSteps: offer.nextSteps,
      contactName: offer.contactName || '',
      contactRole: offer.contactRole || '',
      sentAt: offer.createdAt.toISOString(),
      viewedAt: offer.viewedAt?.toISOString() || null,
      respondedAt: offer.respondedAt?.toISOString() || null,
      expiresAt: offer.expiresAt.toISOString(),
      conditions: offer.conditions || '',
      messageCount: offer.messages.length,
      unread: countUnread(offer.messages, 'student', offer.organizationReadAt),
      messages: [...offer.messages]
        .filter(message => visibleTo(message, 'organization'))
        .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
        .map(message => ({
          id: message.id,
          from: message.sender as 'institution' | 'student' | 'system',
          author: message.authorName,
          body: message.body,
          automatic: message.automatic,
          sentAt: message.sentAt.toISOString(),
          attachment: message.storagePath
            ? { fileName: message.fileName || 'attachment', mimeType: message.mimeType || '', size: message.fileSize || 0 }
            : null
        }))
    };
  }

  private categoryLabel(category: OfferCategory): string {
    return category.charAt(0) + category.slice(1).toLowerCase();
  }

  private statusLabel(status: OfferStatus): string {
    return status.charAt(0) + status.slice(1).toLowerCase();
  }

  private decisionLabel(decision: StudentDecision): string {
    return decision.charAt(0) + decision.slice(1).toLowerCase();
  }

  /**
   * Lazily marks anything past its response window as expired. A scheduled job would
   * be better once one exists; doing it on read keeps the rule true in the meantime.
   */
  private async expireOverdue(where: Prisma.OfferWhereInput) {
    await this.prisma.offer.updateMany({
      where: { ...where, status: { in: ['SENT', 'VIEWED', 'NEGOTIATING'] }, expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' }
    });
  }

  // ── Student side ──────────────────────────────────────────────────────────

  async listForStudent(studentUserId: string) {
    await this.expireOverdue({ studentUserId });
    const offers = await this.prisma.offer.findMany({
      where: { studentUserId, status: { notIn: [] } },
      include: { organization: true, messages: true },
      orderBy: { createdAt: 'desc' }
    });

    const results = offers.map(offer => this.toStudentOffer(offer));
    return {
      results,
      total_results: results.length,
      counts: {
        total: results.length,
        new: results.filter(offer => !offer.viewed).length,
        university: results.filter(offer => offer.category === 'University').length,
        bank: results.filter(offer => offer.category === 'Bank').length,
        scholarship: results.filter(offer => offer.category === 'Scholarship').length,
        consultancy: results.filter(offer => offer.category === 'Consultancy').length,
        saved: results.filter(offer => offer.saved).length,
        accepted: results.filter(offer => offer.status === 'Accepted').length
      }
    };
  }

  /** The student's notification feed, derived from real offer activity. */
  async notificationsForStudent(studentUserId: string) {
    await this.expireOverdue({ studentUserId });
    const offers = await this.prisma.offer.findMany({
      where: { studentUserId, status: { notIn: [] } },
      include: { organization: true, messages: { orderBy: { sentAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: 20
    });

    return {
      notifications: offers.map(offer => {
        const latest = offer.messages[0];
        const fromInstitution = latest?.sender === 'institution';
        return {
          id: offer.id,
          icon: fromInstitution ? '✉' : offer.status === 'EXPIRED' ? '⏱' : '✦',
          title: fromInstitution
            ? `${latest.authorName} replied about ${offer.program}`
            : `${offer.organization.name} · ${offer.headline}`,
          detail: fromInstitution ? latest.body : offer.program,
          occurredAt: (latest?.sentAt || offer.createdAt).toISOString(),
          read: Boolean(offer.viewedAt)
        };
      })
    };
  }

  /**
   * One conversation per offer — the student's Messages screen. Ordered by the
   * most recent message rather than by the offer's own updatedAt, so a busy
   * thread rises to the top.
   */
  async conversationsForStudent(studentUserId: string) {
    const offers = await this.prisma.offer.findMany({
      where: { studentUserId, status: { notIn: [] } },
      include: { organization: true, messages: { orderBy: { sentAt: 'asc' } } }
    });

    const conversations = offers.map(offer => {
      const last = offer.messages[offer.messages.length - 1];
      return {
        offerId: offer.id,
        institution: offer.organization.name,
        initial: offer.organization.name.charAt(0).toUpperCase(),
        contact: offer.contactName || offer.organization.name,
        contactRole: offer.contactRole || '',
        program: offer.program,
        headline: offer.headline,
        status: this.statusLabel(offer.status),
        /** A settled offer can still be discussed; it just cannot be renegotiated. */
        closedToNegotiation: TERMINAL_STATUSES.includes(offer.status),
        unread: countUnread(offer.messages, 'institution', offer.studentReadAt),
        lastMessageAt: (last?.sentAt || offer.createdAt).toISOString(),
        preview: last ? `${last.sender === 'student' ? 'You: ' : ''}${last.body}`.slice(0, 120) : '',
        messages: offer.messages.filter(message => visibleTo(message, 'student')).map(message => ({
          id: message.id,
          from: message.sender as 'institution' | 'student' | 'system',
          author: message.authorName,
          body: message.body,
          automatic: message.automatic,
          sentAt: message.sentAt.toISOString(),
          attachment: message.storagePath
            ? { fileName: message.fileName || 'attachment', mimeType: message.mimeType || '', size: message.fileSize || 0 }
            : null
        }))
      };
    });

    conversations.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    return { conversations, unreadTotal: conversations.reduce((sum, c) => sum + c.unread, 0) };
  }

  private async findOwnedByStudent(studentUserId: string, offerId: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { organization: true, messages: true }
    });
    if (!offer) throw new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'Offer not found' });
    if (offer.studentUserId !== studentUserId) throw new ForbiddenException();
    return offer;
  }

  async markViewed(studentUserId: string, offerId: string) {
    const offer = await this.findOwnedByStudent(studentUserId, offerId);
    /** Already-seen offers announce nothing; the event is "opened for the first time". */
    if (offer.viewedAt) return this.toStudentOffer(offer);

    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: {
        viewedAt: new Date(),
        /** Only advance the organization-side status while the offer is still open. */
        status: offer.status === 'SENT' ? 'VIEWED' : offer.status
      },
      include: { organization: true, messages: true, student: true }
    });

    await this.automation.run('offer.viewed', { offer: updated, actor: 'student', triggerRef: 'viewed' });
    return this.toStudentOffer(await this.findOwnedByStudent(studentUserId, offerId));
  }

  async setFlags(studentUserId: string, offerId: string, flags: OfferFlagsDto) {
    await this.findOwnedByStudent(studentUserId, offerId);
    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: {
        ...(flags.saved === undefined ? {} : { savedByStudent: flags.saved }),
        ...(flags.favourite === undefined ? {} : { favourite: flags.favourite }),
        ...(flags.compared === undefined ? {} : { compared: flags.compared, viewedAt: new Date() })
      },
      include: { organization: true, messages: true }
    });
    return this.toStudentOffer(updated);
  }

  async decide(studentUserId: string, offerId: string, decision: string) {
    const offer = await this.findOwnedByStudent(studentUserId, offerId);
    if (TERMINAL_STATUSES.includes(offer.status)) {
      throw new BadRequestException({
        code: 'OFFER_CLOSED',
        message: `This offer is already ${this.statusLabel(offer.status).toLowerCase()} and can no longer be changed`
      });
    }

    const status = DECISION_TO_STATUS[decision];
    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: {
        studentDecision: decision.toUpperCase() as StudentDecision,
        ...(status ? { status, respondedAt: new Date() } : {}),
        viewedAt: offer.viewedAt || new Date()
      },
      include: { organization: true, messages: true, student: true }
    });

    /*
     * No market is closed or reopened here.
     *
     * A student may be proceeding with several universities and more than one
     * lender at the same time, so accepting one invite says nothing about the
     * others: every offer keeps its own status, and none of the student's other
     * live invites is touched. See marketplace-availability.ts.
     */

    /** One event per decision, so an admin can word each one differently. */
    const decided = decision.toLowerCase();
    const event = decided === 'accepted' ? 'offer.accepted'
      : decided === 'rejected' ? 'offer.rejected'
        : decided === 'shortlisted' ? 'offer.shortlisted'
          : undefined;
    if (event) {
      await this.automation.run(event, { offer: updated, actor: 'student', triggerRef: decided });
    }

    return this.toStudentOffer(await this.findOwnedByStudent(studentUserId, offerId));
  }

  /**
   * The thread stays open after a decision: an accepted offer still needs
   * conversations about visas, documents and start dates. What a terminal state
   * blocks is re-opening the *negotiation*, which is a separate thing from
   * being able to talk.
   */
  async addStudentMessage(studentUserId: string, offerId: string, body: string, authorName: string, attachment?: MessageAttachment) {
    const offer = await this.findOwnedByStudent(studentUserId, offerId);
    await this.prisma.offerMessage.create({
      data: { offerId, sender: 'student', authorName, body, ...attachmentData(attachment) }
    });

    /** A student reply opens a negotiation unless one is running or already settled. */
    if (offer.status === 'SENT' || offer.status === 'VIEWED') {
      await this.prisma.offer.update({ where: { id: offerId }, data: { status: 'NEGOTIATING' } });
      await this.automation.run('offer.negotiating', { offer, actor: 'student', triggerRef: 'negotiating' });
    }
    /** Sending is reading: the sender has seen everything before their own message. */
    await this.prisma.offer.update({ where: { id: offerId }, data: { studentReadAt: new Date() } });
    return this.toStudentOffer(await this.findOwnedByStudent(studentUserId, offerId));
  }

  /** Clears this side's unread badge without touching the other's. */
  async markThreadReadByStudent(studentUserId: string, offerId: string) {
    await this.findOwnedByStudent(studentUserId, offerId);
    await this.prisma.offer.update({ where: { id: offerId }, data: { studentReadAt: new Date() } });
    return { read: true };
  }

  async markThreadReadByOrganization(organizationId: string, offerId: string) {
    await this.findOwnedByOrganization(organizationId, offerId);
    await this.prisma.offer.update({ where: { id: offerId }, data: { organizationReadAt: new Date() } });
    return { read: true };
  }

  /** Total unread across every thread, for the badge in the navigation. */
  async unreadForStudent(studentUserId: string) {
    const offers = await this.prisma.offer.findMany({
      where: { studentUserId, status: { notIn: [] } },
      select: { id: true, studentReadAt: true, messages: { select: { sender: true, sentAt: true } } }
    });
    const threads = offers
      .map(offer => ({ offerId: offer.id, unread: countUnread(offer.messages, 'institution', offer.studentReadAt) }))
      .filter(thread => thread.unread > 0);
    return { total: threads.reduce((sum, thread) => sum + thread.unread, 0), threads };
  }

  async unreadForOrganization(organizationId: string) {
    const offers = await this.prisma.offer.findMany({
      where: { organizationId },
      select: { id: true, organizationReadAt: true, messages: { select: { sender: true, sentAt: true } } }
    });
    const threads = offers
      .map(offer => ({ offerId: offer.id, unread: countUnread(offer.messages, 'student', offer.organizationReadAt) }))
      .filter(thread => thread.unread > 0);
    return { total: threads.reduce((sum, thread) => sum + thread.unread, 0), threads };
  }

  /** One message's attachment, readable only by the two parties to the offer. */
  async attachment(offerId: string, messageId: string, viewer: { studentUserId?: string; organizationId?: string; admin?: boolean }) {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'Offer not found' });

    const allowed = viewer.admin
      || (viewer.studentUserId && offer.studentUserId === viewer.studentUserId)
      || (viewer.organizationId && offer.organizationId === viewer.organizationId);
    if (!allowed) throw new ForbiddenException();

    const message = await this.prisma.offerMessage.findUnique({ where: { id: messageId } });
    if (!message || message.offerId !== offerId || !message.storagePath) {
      throw new NotFoundException({ code: 'ATTACHMENT_NOT_FOUND', message: 'No attachment on that message' });
    }
    return message;
  }

  // ── Organization side ─────────────────────────────────────────────────────

  async create(organization: Organization, dto: CreateOfferDto, senderName: string) {
    const student = await this.prisma.user.findUnique({
      where: { id: dto.studentUserId },
      include: { studentProfile: true }
    });
    if (!student || student.role !== 'STUDENT') {
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'No student found for that id' });
    }
    /** Only submitted profiles are discoverable, so only they can receive offers. */
    if (student.studentProfile?.status !== 'SUBMITTED') {
      throw new BadRequestException({
        code: 'STUDENT_NOT_DISCOVERABLE',
        message: 'This student has not submitted their profile yet'
      });
    }
    /*
     * Hiding someone from the list is not enough on its own: an officer who
     * already holds a student id could still send to them. An alumnus has
     * taken a place somewhere, so an offer would be an intrusion rather than
     * an opportunity.
     */
    if (student.studentProfile.segment === 'ALUMNI') {
      throw new BadRequestException({
        code: 'STUDENT_IS_ALUMNI',
        message: 'This student has already taken up a place, so they are no longer receiving offers.'
      });
    }
    if (!student.studentProfile.discoverable) {
      throw new BadRequestException({
        code: 'STUDENT_NOT_DISCOVERABLE',
        message: 'This student is not currently discoverable.'
      });
    }

    /**
     * The university and programme, copied as they stand right now.
     *
     * An offer is a promise made on a date. Referencing the live programme would
     * let next year's tuition rewrite what a student was already promised — after
     * they had read it, compared it and possibly accepted it. So the figures are
     * taken once, here, and never move again.
     */
    const source = dto.productId
      ? await this.prisma.organizationProduct.findFirst({
          where: { id: dto.productId, organizationId: organization.id }
        })
      : null;

    const programSnapshot = {
      capturedAt: new Date().toISOString(),
      university: {
        name: organization.name,
        city: organization.city,
        country: organization.country,
        website: organization.website,
        logoUrl: this.media.urlFor(organization.logoRef),
        coverUrl: this.media.urlFor(organization.coverRef)
      },
      program: source
        ? {
            name: source.name,
            degreeLevel: source.degreeLevel,
            fieldOfStudy: source.fieldOfStudy,
            durationMonths: source.durationMonths,
            studyMode: source.studyMode,
            campusLocation: source.campusLocation,
            intakes: source.intakes,
            /** Minor units in the row, a decimal string at the edge. */
            tuitionFee: source.tuitionFeeMinor === null ? null : (source.tuitionFeeMinor / 100).toFixed(2),
            currency: source.currency,
            scholarshipInfo: source.scholarshipInfo,
            imageUrl: this.media.urlFor(source.imageRef),
            url: source.url
          }
        : null
    };

    const allowed = CATEGORIES_BY_ORG_TYPE[organization.organizationType] || [];
    const category = (dto.category as OfferCategory) || DEFAULT_CATEGORY_BY_ORG_TYPE[organization.organizationType];
    if (!allowed.includes(category)) {
      throw new BadRequestException({
        code: 'CATEGORY_NOT_ALLOWED',
        message: `A ${organization.organizationType.toLowerCase()} can only send ${allowed.join(' or ').toLowerCase()} offers.`
      });
    }

    const windowDays = dto.responseWindowDays || DEFAULT_RESPONSE_WINDOW_DAYS;
    const offer = await this.prisma.offer.create({
      data: {
        organizationId: organization.id,
        studentUserId: dto.studentUserId,
        category,
        programSnapshot: programSnapshot as Prisma.InputJsonValue,
        program: dto.program,
        headline: dto.headline,
        description: dto.description,
        terms: (dto.terms || {}) as Prisma.InputJsonValue,
        conditions: dto.conditions,
        nextSteps: dto.nextSteps || [],
        contactName: dto.contactName || senderName,
        contactRole: dto.contactRole,
        location: dto.location,
        intake: dto.intake,
        valueLabel: dto.valueLabel,
        value: dto.value,
        templateId: dto.templateId ?? null,
        expiresAt: new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000)
      },
      include: { organization: true, messages: true, student: true }
    });

    /** Counted so a template nobody uses is visible as such. */
    if (dto.templateId) {
      await this.prisma.offerTemplate.update({
        where: { id: dto.templateId },
        data: { usedCount: { increment: 1 } }
      }).catch(() => undefined);
    }

    await this.automation.run('offer.sent', { offer, actor: 'organization', triggerRef: 'sent' });
    return this.toOrganizationOffer(await this.findOwnedByOrganization(organization.id, offer.id));
  }

  /**
   * One click: a product, a student, and the terms the organisation already
   * agreed to for that product.
   *
   * Nothing about the offer is composed here. The template decides the figures,
   * the conditions and the response window, which is the whole reason a single
   * click is a responsible thing to offer an officer.
   */
  async quickInvite(
    organization: Organization,
    input: { studentUserId: string; productId: string; templateId?: string },
    senderName: string
  ) {
    const template = input.templateId
      ? await this.prisma.offerTemplate.findFirst({
          where: { id: input.templateId, organizationId: organization.id, archivedAt: null }
        })
      : await this.prisma.offerTemplate.findFirst({
          where: { productId: input.productId, organizationId: organization.id, archivedAt: null, isDefault: true }
        });

    if (!template) {
      throw new BadRequestException({
        code: 'NO_DEFAULT_TEMPLATE',
        message: 'This product has no offer template yet. Add one before inviting with a single click.'
      });
    }

    const product = await this.prisma.organizationProduct.findFirst({
      where: { id: template.productId, organizationId: organization.id }
    });
    if (!product) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'No such product' });
    }

    return this.create(
      organization,
      {
        studentUserId: input.studentUserId,
        /**
         * The product the template belongs to, so `create` freezes its academic
         * record onto the offer. Without this a one-click invitation reached the
         * student with no degree level, duration, campus, intake, tuition or
         * currency — the very details a template deliberately does not restate.
         */
        productId: product.id,
        program: product.name,
        headline: template.name,
        description: template.description || undefined,
        terms: (template.terms as Record<string, unknown>) || {},
        conditions: template.conditions || undefined,
        nextSteps: template.nextSteps,
        valueLabel: template.valueLabel || undefined,
        value: template.value || undefined,
        responseWindowDays: template.responseWindowDays || undefined,
        templateId: template.id
      } as CreateOfferDto,
      senderName
    );
  }

  async listForOrganization(organizationId: string, status?: string) {
    await this.expireOverdue({ organizationId });
    const normalized = String(status || 'ALL').toUpperCase();
    const offers = await this.prisma.offer.findMany({
      where: {
        organizationId,
        ...(normalized === 'ALL' ? {} : { status: normalized as OfferStatus })
      },
      include: { organization: true, messages: true, student: true },
      orderBy: { createdAt: 'desc' }
    });

    const all = await this.prisma.offer.findMany({ where: { organizationId }, select: { status: true } });
    const count = (value: OfferStatus) => all.filter(offer => offer.status === value).length;

    return {
      offers: offers.map(offer => this.toOrganizationOffer(offer)),
      summary: {
        total: all.length,
        sent: count('SENT'),
        viewed: count('VIEWED'),
        negotiating: count('NEGOTIATING'),
        accepted: count('ACCEPTED'),
        rejected: count('REJECTED'),
        withdrawn: count('WITHDRAWN'),
        expired: count('EXPIRED')
      }
    };
  }

  private async findOwnedByOrganization(organizationId: string, offerId: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { organization: true, messages: true, student: true }
    });
    if (!offer) throw new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'Offer not found' });
    if (offer.organizationId !== organizationId) throw new ForbiddenException();
    return offer;
  }

  /** Withdrawal is one-way and only possible while the offer is still open. */
  async withdraw(organizationId: string, offerId: string) {
    const offer = await this.findOwnedByOrganization(organizationId, offerId);
    if (TERMINAL_STATUSES.includes(offer.status)) {
      throw new BadRequestException({
        code: 'OFFER_CLOSED',
        message: `This offer is already ${this.statusLabel(offer.status).toLowerCase()} and cannot be withdrawn`
      });
    }
    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      include: { organization: true, messages: true, student: true }
    });

    await this.automation.run('offer.withdrawn', { offer: updated, actor: 'organization', triggerRef: 'withdrawn' });
    return this.toOrganizationOffer(await this.findOwnedByOrganization(organizationId, offerId));
  }

  async addOrganizationMessage(organizationId: string, offerId: string, body: string, authorName: string, attachment?: MessageAttachment) {
    await this.findOwnedByOrganization(organizationId, offerId);
    await this.prisma.offerMessage.create({
      data: { offerId, sender: 'institution', authorName, body, ...attachmentData(attachment) }
    });
    await this.prisma.offer.update({ where: { id: offerId }, data: { organizationReadAt: new Date() } });
    return this.toOrganizationOffer(await this.findOwnedByOrganization(organizationId, offerId));
  }
}
