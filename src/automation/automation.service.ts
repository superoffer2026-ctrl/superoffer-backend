import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AutomationRule, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  FIELD_CATALOGUE,
  OPERATORS_BY_TYPE,
  OPERATOR_LABELS,
  validateCondition,
  ConditionNode,
  contextValues,
  describe as describeCondition,
  evaluate as evaluateCondition,
  normalizeCondition
} from './automation.conditions';
import {
  AUTOMATION_EVENTS,
  AutomationContext,
  AutomationEvent,
  DEFAULT_RULES,
  EVENT_DESCRIPTIONS,
  PLACEHOLDER_HELP
} from './automation.types';

const firstNameOf = (full: string) => (full || '').trim().split(/\s+/)[0] || 'there';

const asDate = (value: Date | null | undefined) =>
  value ? value.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

/**
 * Posts an automated message into an offer's thread when something happens.
 *
 * Rules are admin-authored, so which events speak and what they say change
 * without a deploy. Three properties matter more than the feature itself:
 *
 *  - it can never loop, because rules listen only to state changes and human
 *    actions, never to the messages automation itself writes;
 *  - it can never post twice, because every write carries the rule and what it
 *    reacted to, and the database enforces that pair is unique per offer;
 *  - it can never change an offer's lifecycle, because it writes messages
 *    directly rather than going through the paths that move an offer between
 *    states.
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(private prisma: PrismaService) {}

  /** Seeded on first use, so a fresh database still has working automation. */
  private async rulesFor(event: AutomationEvent): Promise<AutomationRule[]> {
    const total = await this.prisma.automationRule.count();
    if (total === 0) await this.seedDefaults();

    return this.prisma.automationRule.findMany({
      where: { event, enabled: true },
      orderBy: { order: 'asc' }
    });
  }

  async seedDefaults() {
    await this.prisma.automationRule.createMany({
      data: DEFAULT_RULES.map(rule => ({ ...rule, system: true })),
      skipDuplicates: true
    });
    this.logger.log(`Seeded ${DEFAULT_RULES.length} default automation rules`);
  }

  /**
   * Runs every rule for an event. Never throws into the caller: an automated
   * courtesy failing must not roll back the student's acceptance.
   */
  async run(event: AutomationEvent, context: AutomationContext): Promise<number> {
    try {
      const rules = await this.rulesFor(event);
      let written = 0;

      for (const rule of rules) {
        if (!this.matches(rule, context)) continue;
        /** A rule that asked to wait joins the queue instead of posting now. */
        if (rule.delayMinutes > 0) {
          await this.schedule(rule, context);
          continue;
        }
        if (await this.write(rule, context)) written++;
      }

      if (written) {
        await this.touchReadState(event, context, written);
      }
      return written;
    } catch (error) {
      this.logger.error(`Automation for ${event} failed: ${(error as Error).message}`);
      return 0;
    }
  }

  /**
   * Whether this rule speaks for this event. A rule with no condition always
   * does; anything else is decided by the condition engine, which reads only
   * the documented context and never throws.
   */
  private matches(rule: AutomationRule, context: AutomationContext): boolean {
    return evaluateCondition(normalizeCondition(rule.condition), contextValues(context));
  }

  /**
   * A delayed rule waits rather than posting. The row carries what it reacted
   * to, so re-emitting the same event cannot queue the nudge twice — the unique
   * index refuses it, exactly as it does for an immediate write.
   */
  private async schedule(rule: AutomationRule, context: AutomationContext): Promise<boolean> {
    const dueAt = new Date(Date.now() + rule.delayMinutes * 60_000);
    try {
      await this.prisma.scheduledAutomation.create({
        data: {
          ruleId: rule.id,
          offerId: context.offer.id,
          triggerRef: context.triggerRef,
          actor: context.actor,
          extra: (context.extra ?? undefined) as Prisma.InputJsonValue | undefined,
          dueAt
        }
      });
      return true;
    } catch (error) {
      if ((error as Prisma.PrismaClientKnownRequestError).code === 'P2002') return false;
      throw error;
    }
  }

  /**
   * Sends whatever has come due.
   *
   * Rows are claimed with a conditional update, so two instances running this
   * at the same moment cannot both send the same message: only one update
   * matches a PENDING row.
   *
   * A guard is re-read here rather than at trigger time, which is the point of
   * waiting — a reminder written three days ago must not go out to a student
   * who replied yesterday. Not sending is an outcome the row records, not a
   * failure it hides.
   */
  async dispatchDue(now = new Date(), limit = 50): Promise<{ sent: number; skipped: number }> {
    const due = await this.prisma.scheduledAutomation.findMany({
      where: { status: 'PENDING', dueAt: { lte: now } },
      orderBy: { dueAt: 'asc' },
      take: limit,
      select: { id: true }
    });

    let sent = 0;
    let skipped = 0;

    for (const { id } of due) {
      /** Claiming and running are separate, so a crash leaves a claimed row to retry. */
      const claimed = await this.prisma.scheduledAutomation.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'CLAIMED', claimedAt: new Date(), attempts: { increment: 1 } }
      });
      if (!claimed.count) continue;

      const row = await this.prisma.scheduledAutomation.findUnique({
        where: { id },
        include: {
          rule: true,
          offer: { include: { organization: true, student: true } }
        }
      });
      if (!row) continue;

      try {
        const context: AutomationContext = {
          offer: row.offer,
          actor: row.actor as 'student' | 'organization',
          triggerRef: row.triggerRef,
          extra: (row.extra as Record<string, string> | null) ?? undefined
        };

        if (!row.rule.enabled) {
          await this.settle(id, 'SKIPPED', 'The rule was switched off while this was waiting');
          skipped++;
          continue;
        }

        const guard = normalizeCondition(row.rule.guard);
        if (!evaluateCondition(guard, contextValues(context))) {
          await this.settle(id, 'SKIPPED', `No longer true: ${describeCondition(guard)}`);
          skipped++;
          continue;
        }

        const written = await this.write(row.rule, context);
        if (written) {
          await this.touchReadState(row.rule.event as AutomationEvent, context, 1);
          await this.settle(id, 'SENT', null);
          sent++;
        } else {
          await this.settle(id, 'SKIPPED', 'This message had already been posted');
          skipped++;
        }
      } catch (error) {
        this.logger.error(`Scheduled automation ${id} failed: ${(error as Error).message}`);
        await this.settle(id, 'FAILED', (error as Error).message);
      }
    }

    return { sent, skipped };
  }

  private settle(id: string, status: string, skipReason: string | null) {
    return this.prisma.scheduledAutomation.update({ where: { id }, data: { status, skipReason } });
  }

  /** What is waiting, for the panel — a queue nobody can see is a queue nobody trusts. */
  async pending(limit = 50) {
    const rows = await this.prisma.scheduledAutomation.findMany({
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: limit,
      include: {
        rule: { select: { label: true, event: true } },
        offer: { select: { program: true, organization: { select: { name: true } } } }
      }
    });
    return {
      scheduled: rows.map(row => ({
        id: row.id,
        rule: row.rule.label,
        event: row.rule.event,
        offer: row.offer.program,
        organization: row.offer.organization.name,
        dueAt: row.dueAt,
        status: row.status,
        skipReason: row.skipReason,
        attempts: row.attempts
      }))
    };
  }

  private async write(rule: AutomationRule, context: AutomationContext): Promise<boolean> {
    const body = this.render(rule.body, context);
    if (!body.trim()) return false;

    const fromOrganization = rule.attribution === 'organization';

    try {
      await this.prisma.offerMessage.create({
        data: {
          offerId: context.offer.id,
          /** A labelled reply still belongs to the organisation's side of the thread. */
          sender: fromOrganization ? 'institution' : 'system',
          automatic: true,
          ruleId: rule.id,
          triggerRef: context.triggerRef,
          audience: rule.audience,
          authorName: fromOrganization
            ? context.offer.contactName || context.offer.organization.name
            : 'SuperOffer',
          body
        }
      });
      return true;
    } catch (error) {
      /** The unique index rejecting a repeat is the mechanism working, not a fault. */
      if ((error as Prisma.PrismaClientKnownRequestError).code === 'P2002') return false;
      throw error;
    }
  }

  /**
   * Automation writing on someone's behalf should not badge them. The actor has
   * just seen the thread; the other side is the one who needs telling.
   */
  private async touchReadState(event: AutomationEvent, context: AutomationContext, written: number) {
    void event;
    void written;
    const now = new Date();
    await this.prisma.offer.update({
      where: { id: context.offer.id },
      data: context.actor === 'student' ? { studentReadAt: now } : { organizationReadAt: now }
    });
  }

  /** Fills the placeholders a rule body may use. Unknown tokens are left alone. */
  render(template: string, context: AutomationContext): string {
    const { offer } = context;
    const studentName = offer.student?.fullName || 'The student';

    const values: Record<string, string> = {
      'student.firstName': firstNameOf(studentName),
      'student.name': studentName,
      'organization.name': offer.organization.name,
      'contact.name': offer.contactName || offer.organization.name,
      'offer.program': offer.program,
      'offer.headline': offer.headline,
      'offer.value': offer.value || '',
      'offer.valueLabel': offer.valueLabel || '',
      'offer.intake': offer.intake || '',
      'offer.deadline': asDate(offer.expiresAt),
      'offer.nextSteps': offer.nextSteps?.length ? `Next: ${offer.nextSteps.join('; ')}.` : '',
      ...(context.extra || {})
    };

    return template
      .replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (whole, token: string) =>
        values[token] !== undefined ? values[token] : whole)
      /** Collapse the gaps an empty placeholder leaves behind. */
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  // ── Authoring ─────────────────────────────────────────────────────────────

  async list() {
    const total = await this.prisma.automationRule.count();
    if (total === 0) await this.seedDefaults();

    const rules = await this.prisma.automationRule.findMany({ orderBy: [{ event: 'asc' }, { order: 'asc' }] });
    return {
      rules,
      events: AUTOMATION_EVENTS.map(event => ({ event, describes: EVENT_DESCRIPTIONS[event] })),
      placeholders: PLACEHOLDER_HELP
    };
  }

  async create(input: Partial<AutomationRule>) {
    this.assertValid(input);
    return this.prisma.automationRule.create({
      data: {
        event: input.event as string,
        label: input.label as string,
        audience: input.audience || 'both',
        attribution: input.attribution || 'system',
        body: input.body as string,
        condition: (input.condition ?? undefined) as Prisma.InputJsonValue | undefined,
        guard: (input.guard ?? undefined) as Prisma.InputJsonValue | undefined,
        delayMinutes: input.delayMinutes ?? 0,
        markUnread: input.markUnread ?? true,
        enabled: input.enabled ?? true,
        order: input.order ?? 1,
        system: false
      }
    });
  }

  async update(id: string, input: Partial<AutomationRule>) {
    const existing = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'RULE_NOT_FOUND', message: 'No such rule' });
    this.assertValid({ ...existing, ...input });

    return this.prisma.automationRule.update({
      where: { id },
      data: {
        event: input.event ?? existing.event,
        label: input.label ?? existing.label,
        audience: input.audience ?? existing.audience,
        attribution: input.attribution ?? existing.attribution,
        body: input.body ?? existing.body,
        condition: (input.condition ?? existing.condition ?? undefined) as Prisma.InputJsonValue | undefined,
        guard: (input.guard ?? existing.guard ?? undefined) as Prisma.InputJsonValue | undefined,
        delayMinutes: input.delayMinutes ?? existing.delayMinutes,
        markUnread: input.markUnread ?? existing.markUnread,
        enabled: input.enabled ?? existing.enabled,
        order: input.order ?? existing.order
      }
    });
  }

  /** Seeded rules can be rewritten or switched off, but not removed. */
  async remove(id: string) {
    const existing = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'RULE_NOT_FOUND', message: 'No such rule' });
    if (existing.system) {
      throw new BadRequestException({
        code: 'SYSTEM_RULE',
        message: 'Built-in rules can be disabled or reworded, but not deleted'
      });
    }
    await this.prisma.automationRule.delete({ where: { id } });
    return { deleted: true };
  }

  /** Renders a rule against a made-up offer, so an admin sees the wording. */
  /**
   * What a condition may read, with the comparisons each field allows and the
   * words for them. The panel renders its editor from this, so the server stays
   * the single definition of what is conditionable.
   */
  conditionFields() {
    return {
      fields: FIELD_CATALOGUE,
      operatorsByType: OPERATORS_BY_TYPE,
      operatorLabels: OPERATOR_LABELS
    };
  }

  /**
   * Reads a condition back in English and says whether it means anything.
   *
   * Refusing a malformed rule here is the difference between an admin seeing
   * their mistake and a rule silently never firing.
   */
  explainCondition(condition: unknown) {
    const problem = validateCondition(condition);
    if (problem) return { valid: false, problem, reads: '' };
    return { valid: true, problem: '', reads: describeCondition(normalizeCondition(condition)) };
  }

  preview(body: string) {
    const sample = {
      id: 'preview',
      program: 'MSc Data Science',
      headline: 'Invitation to apply for MSc Data Science',
      value: '40% tuition',
      valueLabel: 'Scholarship',
      intake: 'Fall 2027',
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      nextSteps: ['Review the terms', 'Upload your transcript'],
      contactName: 'Maya Chen',
      organization: { name: 'Northbridge University', organizationType: 'UNIVERSITY' },
      student: { fullName: 'Aarav Mehta' }
    } as unknown as AutomationContext['offer'];

    return {
      rendered: this.render(body, {
        offer: sample,
        actor: 'student',
        triggerRef: 'preview',
        extra: { 'document.name': 'Academic transcript' }
      })
    };
  }

  private assertValid(input: Partial<AutomationRule>) {
    if (!input.event || !(AUTOMATION_EVENTS as readonly string[]).includes(input.event)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Pick a trigger from the supported list' });
    }
    if (!input.label?.trim()) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Give the rule a name' });
    }
    if (!input.body?.trim()) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'The message cannot be empty' });
    }
    if (!['student', 'organization', 'both'].includes(input.audience || 'both')) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Audience must be student, organization or both' });
    }
    if (!['system', 'organization'].includes(input.attribution || 'system')) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Attribution must be system or organization' });
    }

    /**
     * A condition that means nothing is refused where the admin can see it,
     * rather than evaluating to false forever in a rule that looks enabled.
     */
    for (const [field, value] of [['condition', input.condition], ['guard', input.guard]] as const) {
      const problem = validateCondition(value);
      if (problem) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: field === 'guard' ? `Reason to still send: ${problem}` : problem
        });
      }
    }

    const delay = input.delayMinutes ?? 0;
    if (!Number.isInteger(delay) || delay < 0) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'The wait must be a whole number of minutes' });
    }
    /** A year is past the point where a queued nudge is still about anything. */
    if (delay > 525_600) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'The wait cannot be longer than a year' });
    }
    /** A guard is what makes waiting safe, so it only means something with a wait. */
    if (input.guard && !delay) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A reason to still send only applies to a rule that waits'
      });
    }
  }
}
