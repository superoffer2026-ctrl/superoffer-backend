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
