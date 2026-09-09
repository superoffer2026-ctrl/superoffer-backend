import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Views a plan is worth in one billing period. Enterprise is uncapped. */
export const PLAN_CAPACITY: Record<string, number> = {
  Basic: 50,
  Professional: 200,
  Enterprise: Infinity
};

export const PLAN_NAMES = Object.keys(PLAN_CAPACITY);

const SETTLED = ['PAID'];
const OPEN_INVOICE = ['ISSUED', 'OVERDUE'];

/**
 * What an organisation has been sold, and what they have used of it.
 *
 * Nothing here charges anybody. Payment happens offline — a transfer, a cheque —
 * and our team records it; this is the ledger they record into and the statement
 * the organisation reads back. Two rules follow from that:
 *
 * An unpaid invoice does not switch anybody off. It shows as overdue and a human
 * decides, because cutting off a paying customer over a slow bank transfer costs
 * more than the invoice. Only an explicit admin suspension restricts access.
 *
 * And quota belongs to the period, not the organisation. Counting on the
 * subscription row means a new period starts at zero because it is a new row —
 * there is no reset to run, and none to forget.
 */
@Injectable()
export class BillingService {
  constructor(private prisma: PrismaService) {}

  /** The subscription covering today, paid or not. */
  async activeFor(organizationId: string) {
    const now = new Date();
    return this.prisma.subscription.findFirst({
      where: {
        organizationId,
        status: { not: 'CANCELLED' },
        periodStart: { lte: now },
        periodEnd: { gte: now }
      },
      orderBy: { periodStart: 'desc' }
    });
  }

  /**
   * The plan and quota actually in force.
   *
   * A paid subscription is the only thing that grants a plan. An unpaid one
   * still sets the quota — they are using the service while the invoice is in
   * flight — but it is flagged so the workspace can say so.
   */
  async entitlement(organization: { id: string; plan: string; profilesViewed: number; suspendedAt: Date | null; suspensionReason: string | null }) {
    const active = await this.activeFor(organization.id);
    const plan = active?.plan ?? organization.plan;
    const capacity = PLAN_CAPACITY[plan] ?? PLAN_CAPACITY.Professional;
    const used = active ? active.profilesViewed : organization.profilesViewed;

    const unpaid = !!active && !SETTLED.includes(active.status);
    const overdue = !!active && (active.status === 'OVERDUE' || (active.status === 'ISSUED' && active.periodEnd < new Date()));

    return {
      plan,
      profilesViewed: used,
      capacity: capacity === Infinity ? null : capacity,
      remaining: capacity === Infinity ? null : Math.max(0, capacity - used),
      quotaPercent: capacity === Infinity ? 0 : Math.min(100, Math.round((used / capacity) * 100)),
      unlimited: capacity === Infinity,
      periodStart: active?.periodStart ?? null,
      periodEnd: active?.periodEnd ?? null,
      invoiceNumber: active?.invoiceNumber ?? null,
      paymentStatus: active?.status ?? 'NONE',
      unpaid,
      overdue,
      suspended: !!organization.suspendedAt,
      suspensionReason: organization.suspensionReason
    };
  }

  /**
   * Records that this organisation opened this student, and answers whether the
   * quota allowed it.
   *
   * Unique on (organisation, student, period), so opening the same profile again
   * inside a period costs nothing — they paid to reach a person, not to reload a
   * page. The count is kept on the row rather than derived so the quota bar does
   * not need a scan of every view ever taken.
   */
  async recordProfileView(organizationId: string, studentUserId: string) {
    const active = await this.activeFor(organizationId);
    const subscriptionId = active?.id ?? null;

    const existing = await this.prisma.profileView.findFirst({
      where: { organizationId, studentUserId, subscriptionId }
    });
    if (existing) return { counted: false };

    await this.prisma.profileView.create({ data: { organizationId, studentUserId, subscriptionId } });

    if (active) {
      await this.prisma.subscription.update({
        where: { id: active.id },
        data: { profilesViewed: { increment: 1 } }
      });
    } else {
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { profilesViewed: { increment: 1 } }
      });
    }
    return { counted: true };
  }

  /** Every bill this organisation has, newest first — what they see on their billing page. */
  async invoicesFor(organizationId: string) {
    const rows = await this.prisma.subscription.findMany({
      where: { organizationId, status: { not: 'DRAFT' } },
      orderBy: { periodStart: 'desc' }
    });
    return rows.map(row => this.toInvoice(row));
  }

  toInvoice(row: {
    invoiceNumber: string; plan: string; amountMinor: number; currency: string; status: string;
    periodStart: Date; periodEnd: Date; paidAt: Date | null; paymentRef: string | null;
    profilesViewed: number; note: string | null;
  }) {
    return {
      invoiceNumber: row.invoiceNumber,
      plan: row.plan,
      /** Minor units in the database, a decimal string at the edge — never a float in between. */
      amount: (row.amountMinor / 100).toFixed(2),
      currency: row.currency,
      status: row.status,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      paidAt: row.paidAt,
      paymentRef: row.paymentRef,
      profilesViewed: row.profilesViewed,
      note: row.note
    };
  }

  // ── What an admin does ────────────────────────────────────────────────────

  /** `SO-2026-0007`: readable, ordered, and unique per year. */
  private async nextInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `SO-${year}-`;
    const last = await this.prisma.subscription.findFirst({
      where: { invoiceNumber: { startsWith: prefix } },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true }
    });
    const next = last ? Number(last.invoiceNumber.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  async createSubscription(input: {
    organizationId: string; plan: string; periodStart: string; periodEnd: string;
    amount: number; currency?: string; note?: string;
  }) {
    if (!PLAN_CAPACITY[input.plan]) {
      throw new BadRequestException({ code: 'UNKNOWN_PLAN', message: `Plan must be one of ${PLAN_NAMES.join(', ')}` });
    }
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    if (Number.isNaN(+periodStart) || Number.isNaN(+periodEnd) || periodEnd <= periodStart) {
      throw new BadRequestException({ code: 'BAD_PERIOD', message: 'The billing period must end after it starts' });
    }
    if (!(input.amount >= 0)) {
      throw new BadRequestException({ code: 'BAD_AMOUNT', message: 'Enter the agreed amount' });
    }

    const organization = await this.prisma.organization.findUnique({ where: { id: input.organizationId } });
    if (!organization) throw new NotFoundException({ code: 'ORG_NOT_FOUND', message: 'No such organisation' });

    return this.prisma.subscription.create({
      data: {
        organizationId: input.organizationId,
        plan: input.plan,
        periodStart,
        periodEnd,
        amountMinor: Math.round(input.amount * 100),
        currency: input.currency || 'INR',
        invoiceNumber: await this.nextInvoiceNumber(),
        note: input.note ?? null
      }
    });
  }

  /** The money landed. Recorded by hand, because it arrived by hand. */
  async markPaid(subscriptionId: string, input: { paymentRef?: string; recordedBy?: string; paidAt?: string }) {
    const row = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!row) throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND', message: 'No such subscription' });
    if (row.status === 'CANCELLED') {
      throw new BadRequestException({ code: 'CANCELLED', message: 'A cancelled subscription cannot be paid' });
    }

    return this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'PAID',
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        paymentRef: input.paymentRef ?? null,
        recordedBy: input.recordedBy ?? null
      }
    });
  }

  async setStatus(subscriptionId: string, status: string) {
    if (!['DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'CANCELLED'].includes(status)) {
      throw new BadRequestException({ code: 'BAD_STATUS', message: 'Unknown invoice status' });
    }
    const row = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!row) throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND', message: 'No such subscription' });
    return this.prisma.subscription.update({ where: { id: subscriptionId }, data: { status } });
  }

  /** Deliberately a decision, not a consequence of an unpaid invoice. */
  async setSuspension(organizationId: string, suspended: boolean, reason?: string) {
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        suspendedAt: suspended ? new Date() : null,
        suspensionReason: suspended ? reason ?? 'Suspended by an administrator' : null
      }
    });
  }

  /** Every organisation with what they are on and what they owe. */
  async overview() {
    const organizations = await this.prisma.organization.findMany({
      orderBy: { name: 'asc' },
      include: { subscriptions: { orderBy: { periodStart: 'desc' } } }
    });

    const now = new Date();
    return organizations.map(org => {
      const active = org.subscriptions.find(s => s.status !== 'CANCELLED' && s.periodStart <= now && s.periodEnd >= now);
      const outstanding = org.subscriptions.filter(s => OPEN_INVOICE.includes(s.status));
      return {
        organizationId: org.id,
        name: org.name,
        organizationType: org.organizationType,
        plan: active?.plan ?? org.plan,
        paymentStatus: active?.status ?? 'NONE',
        periodEnd: active?.periodEnd ?? null,
        profilesViewed: active ? active.profilesViewed : org.profilesViewed,
        outstandingInvoices: outstanding.length,
        outstandingMinor: outstanding.reduce((sum, s) => sum + s.amountMinor, 0),
        suspended: !!org.suspendedAt,
        suspensionReason: org.suspensionReason,
        invoices: org.subscriptions.map(s => ({ id: s.id, ...this.toInvoice(s) }))
      };
    });
  }
}
