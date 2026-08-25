import { AutomationContext } from './automation.types';

/**
 * Conditions: what turns nine events into as many triggers as an admin needs.
 *
 * A rule used to narrow on two hardcoded keys, so "when a lender sends an offer"
 * was expressible and "when a lender sends an offer worth more than twenty lakh
 * to a student in India" was not. The difference is not more keys — it is
 * letting the admin compose predicates over a documented context.
 *
 * Three properties are deliberate:
 *
 *  - the catalogue is closed. A predicate names a field from FIELD_CATALOGUE and
 *    nothing else, so a rule cannot reach into arbitrary data or be used to
 *    probe for it;
 *  - evaluation cannot throw. A malformed predicate is false, never an
 *    exception, because a broken rule must not roll back a student's decision;
 *  - every condition can describe itself in English, so the admin panel and the
 *    audit log say what a rule actually does rather than showing raw JSON.
 */

export type ConditionOperator =
  | 'is' | 'isNot' | 'contains' | 'notContains'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'isSet' | 'isEmpty'
  | 'in' | 'notIn';

export interface ConditionPredicate {
  field: string;
  operator: ConditionOperator;
  /** Absent for isSet / isEmpty. An array for in / notIn. */
  value?: string | number | string[];
}

export interface ConditionGroup {
  /** Every child must hold. */
  all?: ConditionNode[];
  /** At least one child must hold. */
  any?: ConditionNode[];
}

export type ConditionNode = ConditionPredicate | ConditionGroup;

export type FieldType = 'text' | 'number' | 'enum';

export interface FieldDescriptor {
  key: string;
  label: string;
  type: FieldType;
  /** For enums, the values the admin may choose between. */
  options?: string[];
  describes: string;
}

/**
 * Everything a condition may read.
 *
 * Adding a row here is what makes a new field conditionable; the evaluator has
 * no other way in.
 */
export const FIELD_CATALOGUE: FieldDescriptor[] = [
  /*
   * The two sides name the same offer differently — what an organisation calls
   * SENT, the student sees as PENDING — so both are offered rather than one
   * being translated into the other's words and quietly meaning something else.
   */
  {
    key: 'offer.status', label: 'Offer status (organisation view)', type: 'enum',
    options: ['SENT', 'VIEWED', 'NEGOTIATING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
    describes: 'Where the offer stands for the organisation that sent it'
  },
  {
    key: 'offer.studentDecision', label: 'Student decision', type: 'enum',
    options: ['PENDING', 'SHORTLISTED', 'ACCEPTED', 'REJECTED'],
    describes: 'What the student has decided, if anything'
  },
  {
    key: 'offer.category', label: 'Offer category', type: 'enum',
    options: ['University', 'Bank', 'Scholarship'],
    describes: 'What kind of offer it is'
  },
  { key: 'offer.program', label: 'Programme or product', type: 'text', describes: 'The course or product named on the offer' },
  { key: 'offer.headline', label: 'Offer headline', type: 'text', describes: 'The headline the sender wrote' },
  { key: 'offer.value', label: 'Offer amount', type: 'number', describes: 'The stated amount, read as a number where one is stated' },
  { key: 'offer.valueLabel', label: 'Amount is called', type: 'text', describes: 'Scholarship, loan amount, and so on' },
  { key: 'offer.intake', label: 'Intake', type: 'text', describes: 'The intake the offer is for' },
  { key: 'offer.daysToDeadline', label: 'Days until the deadline', type: 'number', describes: 'Negative once the deadline has passed' },
  {
    key: 'organization.type', label: 'Organisation type', type: 'enum',
    options: ['UNIVERSITY', 'BANK'],
    describes: 'Whether a university or a lender sent it'
  },
  { key: 'organization.name', label: 'Organisation name', type: 'text', describes: 'Who sent the offer' },
  { key: 'organization.country', label: 'Organisation country', type: 'text', describes: 'Where the sender is registered' },
  { key: 'student.name', label: 'Student name', type: 'text', describes: 'The full name on the profile' },
  {
    key: 'actor', label: 'Who caused it', type: 'enum',
    options: ['student', 'organization'],
    describes: 'The side whose action fired the event'
  }
];

const FIELD_KEYS = new Set(FIELD_CATALOGUE.map(field => field.key));

/** Which operators make sense for a field of each type. */
export const OPERATORS_BY_TYPE: Record<FieldType, ConditionOperator[]> = {
  text: ['is', 'isNot', 'contains', 'notContains', 'isSet', 'isEmpty'],
  number: ['is', 'isNot', 'gt', 'gte', 'lt', 'lte', 'isSet', 'isEmpty'],
  enum: ['is', 'isNot', 'in', 'notIn', 'isSet', 'isEmpty']
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  is: 'is',
  isNot: 'is not',
  contains: 'contains',
  notContains: 'does not contain',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  isSet: 'has any value',
  isEmpty: 'is empty',
  in: 'is one of',
  notIn: 'is none of'
};

/** The first run of digits in a free-text amount, so "₹32,00,000" compares as a number. */
const numberIn = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const digits = String(value ?? '').replace(/[^\d.]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
};

const daysUntil = (date: Date | null | undefined): number | null => {
  if (!date) return null;
  const ms = new Date(date).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.ceil((ms - Date.now()) / 86400000);
};

/**
 * The flat record a condition reads.
 *
 * Built once per evaluation and never handed to a template, so widening the
 * catalogue cannot widen what a message body can print.
 */
export function contextValues(context: AutomationContext): Record<string, unknown> {
  const { offer } = context;
  return {
    'offer.status': offer.status,
    'offer.studentDecision': offer.studentDecision,
    'offer.category': offer.category,
    'offer.program': offer.program,
    'offer.headline': offer.headline,
    'offer.value': offer.value,
    'offer.valueLabel': offer.valueLabel,
    'offer.intake': offer.intake,
    'offer.daysToDeadline': daysUntil(offer.expiresAt),
    'organization.type': offer.organization.organizationType,
    'organization.name': offer.organization.name,
    'organization.country': offer.organization.country,
    /* The student's country lives on their profile, which an offer does not
       carry — so it is not offered as a field rather than being offered and
       always reading empty. */
    'student.name': offer.student?.fullName ?? null,
    actor: context.actor
  };
}

const isGroup = (node: ConditionNode): node is ConditionGroup =>
  !!node && (Array.isArray((node as ConditionGroup).all) || Array.isArray((node as ConditionGroup).any));

const asText = (value: unknown) => String(value ?? '').trim().toLowerCase();

function evaluatePredicate(predicate: ConditionPredicate, values: Record<string, unknown>): boolean {
  /** A field outside the catalogue is not a question this engine answers. */
  if (!FIELD_KEYS.has(predicate.field)) return false;

  const actual = values[predicate.field];
  const present = actual !== null && actual !== undefined && String(actual).trim() !== '';

  switch (predicate.operator) {
    case 'isSet': return present;
    case 'isEmpty': return !present;
    case 'is': return asText(actual) === asText(predicate.value);
    case 'isNot': return asText(actual) !== asText(predicate.value);
    case 'contains': return present && asText(actual).includes(asText(predicate.value));
    case 'notContains': return !asText(actual).includes(asText(predicate.value));
    case 'in':
    case 'notIn': {
      const list = Array.isArray(predicate.value) ? predicate.value : [predicate.value as string];
      const hit = list.some(entry => asText(entry) === asText(actual));
      return predicate.operator === 'in' ? hit : !hit;
    }
    case 'gt': case 'gte': case 'lt': case 'lte': {
      const left = numberIn(actual);
      const right = numberIn(predicate.value);
      /** Comparing an unstated amount is unanswerable, so the rule does not fire. */
      if (left === null || right === null) return false;
      if (predicate.operator === 'gt') return left > right;
      if (predicate.operator === 'gte') return left >= right;
      if (predicate.operator === 'lt') return left < right;
      return left <= right;
    }
    default: return false;
  }
}

/**
 * Legacy shape: `{ organizationType, category }`, written before conditions were
 * composable. Read rather than migrated, so a rule authored then keeps working.
 */
function fromLegacy(condition: Record<string, unknown>): ConditionNode | null {
  const all: ConditionNode[] = [];
  if (typeof condition.organizationType === 'string' && condition.organizationType) {
    all.push({ field: 'organization.type', operator: 'is', value: condition.organizationType });
  }
  if (typeof condition.category === 'string' && condition.category) {
    all.push({ field: 'offer.category', operator: 'is', value: condition.category });
  }
  return all.length ? { all } : null;
}

/** Anything stored in the column, as a node this engine understands. */
export function normalizeCondition(stored: unknown): ConditionNode | null {
  if (!stored || typeof stored !== 'object') return null;
  const value = stored as Record<string, unknown>;
  if (Array.isArray(value.all) || Array.isArray(value.any)) return value as ConditionGroup;
  if (typeof value.field === 'string') return value as unknown as ConditionPredicate;
  return fromLegacy(value);
}

/** No condition means no narrowing, so an empty rule still fires. */
export function evaluate(node: ConditionNode | null, values: Record<string, unknown>): boolean {
  if (!node) return true;
  if (isGroup(node)) {
    if (Array.isArray(node.all) && node.all.length) {
      return node.all.every(child => evaluate(child, values));
    }
    if (Array.isArray(node.any) && node.any.length) {
      return node.any.some(child => evaluate(child, values));
    }
    return true;
  }
  return evaluatePredicate(node, values);
}

/** What the rule says, in words, for the panel and the audit log. */
export function describe(node: ConditionNode | null): string {
  if (!node) return 'every time';
  if (isGroup(node)) {
    const children = node.all ?? node.any ?? [];
    if (!children.length) return 'every time';
    const joiner = node.all ? ' and ' : ' or ';
    return children.map(child => (isGroup(child) ? `(${describe(child)})` : describe(child))).join(joiner);
  }
  const field = FIELD_CATALOGUE.find(entry => entry.key === node.field);
  const label = field?.label || node.field;
  const operator = OPERATOR_LABELS[node.operator] || node.operator;
  if (node.operator === 'isSet' || node.operator === 'isEmpty') return `${label} ${operator}`;
  const value = Array.isArray(node.value) ? node.value.join(', ') : String(node.value ?? '');
  return `${label} ${operator} ${value}`;
}

/**
 * Rejects a malformed condition at the point it is written rather than letting
 * it fail silently at evaluation, where nobody would see it.
 */
export function validateCondition(node: unknown, depth = 0): string {
  if (node === null || node === undefined) return '';
  if (typeof node !== 'object') return 'A condition must be a group or a single test';
  if (depth > 4) return 'Conditions may not nest more than four groups deep';

  const value = node as Record<string, unknown>;
  if (Array.isArray(value.all) || Array.isArray(value.any)) {
    const children = (value.all ?? value.any) as unknown[];
    if (!Array.isArray(children)) return 'A group must hold a list of tests';
    for (const child of children) {
      const problem = validateCondition(child, depth + 1);
      if (problem) return problem;
    }
    return '';
  }

  const field = FIELD_CATALOGUE.find(entry => entry.key === value.field);
  if (!field) return `"${String(value.field)}" is not a field a rule can read`;

  const operator = value.operator as ConditionOperator;
  if (!OPERATORS_BY_TYPE[field.type].includes(operator)) {
    return `"${OPERATOR_LABELS[operator] || String(operator)}" cannot be used with ${field.label}`;
  }

  const needsValue = operator !== 'isSet' && operator !== 'isEmpty';
  if (needsValue) {
    const provided = value.value;
    const empty = provided === undefined || provided === null || String(provided).trim() === '';
    if (empty) return `${field.label} needs a value to compare against`;
    if ((operator === 'in' || operator === 'notIn') && !Array.isArray(provided)) {
      return `${field.label} needs a list of values`;
    }
    if (field.type === 'number' && !Array.isArray(provided) && numberIn(provided) === null) {
      return `${field.label} needs a number`;
    }
  }
  return '';
}
