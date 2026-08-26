import { Offer, Organization, User } from '@prisma/client';

/**
 * The events automation listens to.
 *
 * Every one is a *state* change or a human action — never an automated message,
 * so a rule can never trigger another rule. That is the single guard that keeps
 * a thank-you from replying to itself forever.
 */
export const AUTOMATION_EVENTS = [
  'offer.sent',
  'offer.viewed',
  'offer.negotiating',
  'offer.accepted',
  'offer.rejected',
  'offer.shortlisted',
  'offer.withdrawn',
  'offer.expired',
  'document.uploaded'
] as const;

export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

/** Plain-English descriptions, shown in the admin panel beside each trigger. */
export const EVENT_DESCRIPTIONS: Record<AutomationEvent, string> = {
  'offer.sent': 'An organisation sends an invitation to a student',
  'offer.viewed': 'The student opens the offer for the first time',
  'offer.negotiating': 'The student replies and opens a negotiation',
  'offer.accepted': 'The student accepts the offer',
  'offer.rejected': 'The student declines the offer',
  'offer.shortlisted': 'The student shortlists the offer to decide later',
  'offer.withdrawn': 'The organisation withdraws the offer',
  'offer.expired': 'The response window closes without a decision',
  'document.uploaded': 'The student uploads a document'
};

/** Who a rule addresses. The actor is never badged for their own action. */
export type Audience = 'student' | 'organization' | 'both';

/** A neutral notice, or a reply shown as coming from the organisation. */
export type Attribution = 'system' | 'organization';

export interface AutomationContext {
  offer: Offer & { organization: Organization; student?: User | null };
  /**
   * Who caused the event. Their side is not badged, because a student does not
   * need an unread marker for something they just did.
   */
  actor: 'student' | 'organization';
  /**
   * What the rule is reacting to, used with the rule id to keep the write
   * idempotent — usually the new status or the id of the thing that changed.
   */
  triggerRef: string;
  /** Extra placeholders for a specific event, e.g. an uploaded document's name. */
  extra?: Record<string, string>;
}

/** The placeholders a rule body may use, with what each resolves to. */
export const PLACEHOLDER_HELP: Array<{ token: string; describes: string }> = [
  { token: '{{student.firstName}}', describes: "The student's first name" },
  { token: '{{student.name}}', describes: "The student's full name" },
  { token: '{{organization.name}}', describes: 'The organisation that sent the offer' },
  { token: '{{contact.name}}', describes: 'The named officer on the offer' },
  { token: '{{offer.program}}', describes: 'The programme or product' },
  { token: '{{offer.headline}}', describes: "The offer's headline" },
  { token: '{{offer.value}}', describes: 'The scholarship or loan amount' },
  { token: '{{offer.valueLabel}}', describes: 'What that amount is called' },
  { token: '{{offer.intake}}', describes: 'The intake' },
  { token: '{{offer.deadline}}', describes: 'The response deadline, as a date' },
  { token: '{{offer.nextSteps}}', describes: 'The next steps, as a sentence' },
  { token: '{{document.name}}', describes: 'The uploaded document (upload events only)' }
];

/**
 * The rules a fresh installation starts with.
 *
 * They are marked `system`, which means an admin can rewrite or switch them off
 * but not delete them — so the set of triggers stays discoverable even after
 * someone has emptied the list.
 */
export const DEFAULT_RULES: Array<{
  event: AutomationEvent;
  label: string;
  audience: Audience;
  attribution: Attribution;
  body: string;
  markUnread: boolean;
  order: number;
}> = [
  {
    event: 'offer.sent',
    label: 'Welcome the student to a new offer',
    audience: 'student',
    attribution: 'organization',
    body: 'Hello {{student.firstName}}, thank you for your interest. Please review the terms for {{offer.program}} and reply here with any questions — we are happy to help.',
    markUnread: true,
    order: 1
  },
  {
    event: 'offer.viewed',
    label: 'Tell the officer the offer was opened',
    audience: 'organization',
    attribution: 'system',
    body: '{{student.name}} opened this offer.',
    markUnread: false,
    order: 1
  },
  {
    event: 'offer.accepted',
    label: 'Record the acceptance',
    audience: 'both',
    attribution: 'system',
    body: '{{student.name}} accepted this offer.',
    markUnread: true,
    order: 1
  },
  {
    event: 'offer.accepted',
    label: 'Thank the student for accepting',
    audience: 'student',
    attribution: 'organization',
    body: 'Thank you for accepting, {{student.firstName}}! We are delighted to welcome you to {{offer.program}}. {{offer.nextSteps}} We will be in touch shortly about the next steps.',
    markUnread: true,
    order: 2
  },
  {
    event: 'offer.rejected',
    label: 'Record the decline',
    audience: 'both',
    attribution: 'system',
    body: '{{student.name}} declined this offer.',
    markUnread: true,
    order: 1
  },
  {
    event: 'offer.rejected',
    label: 'Leave the door open',
    audience: 'student',
    attribution: 'organization',
    body: 'Thank you for letting us know, {{student.firstName}}. If your plans change, you are welcome to get in touch with {{organization.name}} again.',
    markUnread: false,
    order: 2
  },
  {
    event: 'offer.shortlisted',
    label: 'Record the shortlisting',
    audience: 'organization',
    attribution: 'system',
    body: '{{student.name}} shortlisted this offer to decide later.',
    markUnread: true,
    order: 1
  },
  {
    event: 'offer.withdrawn',
    label: 'Record the withdrawal',
    audience: 'student',
    attribution: 'system',
    body: '{{organization.name}} withdrew this offer.',
    markUnread: true,
    order: 1
  },
  {
    event: 'offer.expired',
    label: 'Record the expiry',
    audience: 'both',
    attribution: 'system',
    body: 'This offer expired on {{offer.deadline}} without a decision.',
    markUnread: false,
    order: 1
  },
  {
    event: 'document.uploaded',
    label: 'Tell the officer a document arrived',
    audience: 'organization',
    attribution: 'system',
    body: '{{student.name}} uploaded {{document.name}}.',
    markUnread: true,
    order: 1
  }
];

// ── Channels and actions ────────────────────────────────────────────────────

/**
 * Where a message can go.
 *
 * `inapp` is the offer thread — the native chat both sides already read, and
 * the only channel that cannot bounce. The other two leave the building, which
 * is why every one of them records a delivery row.
 */
export const CHANNELS = ['inapp', 'email', 'whatsapp', 'sms'] as const;
export type ChannelKey = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  inapp: 'Native chat',
  email: 'Email',
  whatsapp: 'WhatsApp',
  sms: 'SMS'
};

export const CHANNEL_DESCRIPTIONS: Record<ChannelKey, string> = {
  inapp: 'Posted in the offer thread, where both sides already talk',
  email: 'Sent to the address on the account',
  whatsapp: 'Sent to the mobile on the account, as a registered template',
  sms: 'Sent to the mobile on the account. Indian numbers need a DLT-registered template'
};

/**
 * A WhatsApp message outside the 24-hour service window has to be one of Meta's
 * pre-approved templates, so a rule cannot simply reuse its typed body. The
 * name is what was registered; the params are placeholder strings, rendered the
 * same way the body is, and passed in order.
 */
export interface ChannelTemplate {
  name: string;
  params: string[];
}

/**
 * What one channel says, when it should not say what the others say.
 *
 * A line that reads well in the offer thread reads like a fragment as an
 * email, and WhatsApp cannot carry free text at all outside its service
 * window. Anything left blank here falls back to the action's own body, so a
 * rule that is happy saying one thing everywhere still only says it once.
 */
export interface ChannelContent {
  body?: string;
  /** Email only. */
  subject?: string;
  /** WhatsApp only, and required there. */
  template?: ChannelTemplate;
}

/**
 * One thing a rule does.
 *
 * A discriminated union rather than a bag of optional fields, so adding a
 * webhook or a bot handoff later is a new member and not a new set of columns
 * every existing action has to ignore.
 */
export type AutomationAction = NotifyAction;

export interface NotifyAction {
  type: 'notify';
  /** Empty means the native chat, which is what every rule did before this. */
  channels: ChannelKey[];
  audience: Audience;
  attribution: Attribution;
  body: string;
  /** Email only; falls back to the rule's label when blank. */
  subject?: string;
  /** Required for WhatsApp outside an open service window. */
  templates?: Partial<Record<ChannelKey, ChannelTemplate>>;
  /** Per-channel wording. Anything absent falls back to `body`/`subject`. */
  content?: Partial<Record<ChannelKey, ChannelContent>>;
  /**
   * Minutes to wait before this action runs.
   *
   * Held on the action rather than the rule so one trigger can post to the
   * thread at once and send a reminder three days later, which is the whole
   * point of separating instant work from scheduled work.
   */
  delayMinutes?: number;
  markUnread?: boolean;
}

/** What a channel should say for this action, after the fallbacks. */
export function contentFor(action: NotifyAction, channel: ChannelKey): ChannelContent {
  const own = action.content?.[channel] ?? {};
  return {
    body: own.body?.trim() ? own.body : action.body,
    subject: own.subject?.trim() ? own.subject : action.subject,
    /** The older shape stored templates on their own; still read it. */
    template: own.template ?? action.templates?.[channel]
  };
}

/** The wait this action asks for, falling back to the rule's own. */
export function delayOf(action: NotifyAction, ruleDelayMinutes: number): number {
  const own = action.delayMinutes;
  return typeof own === 'number' && own >= 0 ? own : ruleDelayMinutes;
}

export const ACTION_TYPES = ['notify'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_LABELS: Record<ActionType, string> = {
  notify: 'Send a message'
};

/** A rule written before actions existed, read as the one action it always was. */
export function actionsOf(rule: {
  actions?: unknown;
  audience: string;
  attribution: string;
  body: string;
  markUnread?: boolean;
}): AutomationAction[] {
  const stored = Array.isArray(rule.actions) ? (rule.actions as AutomationAction[]) : [];
  if (stored.length) return stored;
  return [
    {
      type: 'notify',
      channels: ['inapp'],
      audience: (rule.audience || 'both') as Audience,
      attribution: (rule.attribution || 'system') as Attribution,
      body: rule.body || '',
      markUnread: rule.markUnread !== false
    }
  ];
}

/**
 * Whether an action is well formed, in words.
 *
 * Returns the complaints rather than throwing: the admin panel shows all of
 * them at once, and a rule with one bad action should say which.
 */
export function validateAction(action: unknown, index: number): string[] {
  const at = `Action ${index + 1}`;
  if (!action || typeof action !== 'object') return [`${at} is not an action.`];
  const a = action as Partial<NotifyAction>;

  if (a.type !== 'notify') return [`${at} has an unknown type "${String(a.type)}".`];

  const problems: string[] = [];
  if (!a.body || !a.body.trim()) problems.push(`${at} has no message.`);

  const channels = Array.isArray(a.channels) ? a.channels : [];
  if (!channels.length) problems.push(`${at} has no channel selected.`);
  for (const channel of channels) {
    if (!(CHANNELS as readonly string[]).includes(channel)) {
      problems.push(`${at} names a channel we cannot send on: "${channel}".`);
    }
  }

  if (a.audience && !['student', 'organization', 'both'].includes(a.audience)) {
    problems.push(`${at} has an audience we do not recognise.`);
  }
  if (a.attribution && !['system', 'organization'].includes(a.attribution)) {
    problems.push(`${at} has an attribution we do not recognise.`);
  }

  /*
   * A WhatsApp action with no template will be refused by Meta the moment the
   * service window is closed, which is most of the time. Saying so here beats
   * finding out from a delivery row three days later.
   */
  if (channels.includes('whatsapp')) {
    const template = a.content?.whatsapp?.template ?? a.templates?.whatsapp;
    if (!template || !template.name) {
      problems.push(`${at} sends on WhatsApp but names no approved template.`);
    }
  }

  /*
   * Indian SMS is not free text either.
   *
   * A message to an Indian number has to match a template registered on the
   * DLT platform, under a registered sender ID. An unregistered send is
   * rejected by the operator, not delivered late — so this is checked when the
   * rule is written rather than discovered in a delivery row.
   */
  if (channels.includes('sms')) {
    const template = a.content?.sms?.template;
    if (!template || !template.name) {
      problems.push(`${at} sends on SMS but names no DLT-registered template.`);
    }
  }

  if (typeof a.delayMinutes === 'number' && a.delayMinutes < 0) {
    problems.push(`${at} cannot wait for a negative time.`);
  }

  return problems;
}
