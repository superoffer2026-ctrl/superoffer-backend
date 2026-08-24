import { EngineDependency, ENGINE_DEPENDENCIES } from './form-schema.types';

/**
 * The forms an admin can edit.
 *
 * A form and a variant together name one editable document. For the student
 * profile the variant is an audience (`DEFAULT`, `UG`, `PG`); for an organisation
 * form it is the organisation type, because a lender's invitation and a
 * university's are genuinely different forms rather than versions of one.
 */
export const FORM_KEYS = ['STUDENT_PROFILE', 'ORG_OFFER', 'ORG_PRODUCT', 'ORG_PRODUCT_INVITE'] as const;

export type FormKey = (typeof FORM_KEYS)[number];

export const isFormKey = (value: string): value is FormKey => (FORM_KEYS as readonly string[]).includes(value);

export interface FormDescriptor {
  key: FormKey;
  label: string;
  describes: string;
  /** Who fills this form in. */
  owner: 'student' | 'organization';
  /** The variants that exist for it, and what each is called. */
  variants: Array<{ variant: string; label: string }>;
  /** Whether an admin may add variants of their own beyond the listed ones. */
  variantsAreFixed: boolean;
  /** Fields the rest of the product stops working without. */
  dependencies: EngineDependency[];
}

/**
 * What an offer cannot do without.
 *
 * These are not matching-engine inputs like the student ones — they are the
 * fields the offer record itself is built from. Remove `course` and a candidate
 * row has nothing to name; remove `deadline` and nothing ever expires.
 */
const OFFER_DEPENDENCIES: EngineDependency[] = [
  { section: 'offerTerms', field: 'student', usedBy: ['Who the offer is sent to'] },
  { section: 'offerTerms', field: 'course', usedBy: ['Offer headline', 'Candidate course column', 'Student inbox'] },
  { section: 'offerTerms', field: 'deadline', usedBy: ['Response window', 'Expiry', 'Decision-by column'] }
];

const PRODUCT_DEPENDENCIES: EngineDependency[] = [
  { section: 'productDetails', field: 'name', usedBy: ['Product picker on the invitation form', 'Catalogue list'] },
  { section: 'productDetails', field: 'category', usedBy: ['Grouping in the catalogue', 'Preset matching'] }
];

const ORG_VARIANTS = [
  { variant: 'UNIVERSITY', label: 'Universities' },
  { variant: 'BANK', label: 'Education lenders' },
  { variant: 'CONSULTANCY', label: 'Consultancies' }
];

export const FORM_REGISTRY: Record<FormKey, FormDescriptor> = {
  STUDENT_PROFILE: {
    key: 'STUDENT_PROFILE',
    label: 'Student profile',
    describes: 'The eight-step profile a student completes before they are discoverable',
    owner: 'student',
    variants: [{ variant: 'DEFAULT', label: 'Standard student profile' }],
    /** An admin may add audiences such as UG or PG. */
    variantsAreFixed: false,
    dependencies: ENGINE_DEPENDENCIES
  },
  ORG_OFFER: {
    key: 'ORG_OFFER',
    label: 'Invitation to a student',
    describes: 'What an officer fills in to send a student an offer',
    owner: 'organization',
    variants: ORG_VARIANTS,
    /** One per organisation type, and no others: the type is what the form is for. */
    variantsAreFixed: true,
    dependencies: OFFER_DEPENDENCIES
  },
  ORG_PRODUCT: {
    key: 'ORG_PRODUCT',
    label: 'Product catalogue entry',
    describes: 'What an organisation records about a course, scholarship or loan product',
    owner: 'organization',
    variants: ORG_VARIANTS,
    variantsAreFixed: true,
    dependencies: PRODUCT_DEPENDENCIES
  },
  ORG_PRODUCT_INVITE: {
    key: 'ORG_PRODUCT_INVITE',
    label: 'Product invitation',
    describes: 'The short form for inviting a student to named products',
    owner: 'organization',
    variants: ORG_VARIANTS,
    variantsAreFixed: true,
    dependencies: []
  }
};

/** The variant to fall back to when a form has no document for the one asked for. */
export const fallbackVariant = (formKey: FormKey) =>
  formKey === 'STUDENT_PROFILE' ? 'DEFAULT' : 'UNIVERSITY';
