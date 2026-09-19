import { FormFieldDef, FormSchemaDef, FormSectionDef } from './form-schema.types';
import { FormKey } from './form-registry';

/**
 * The organisation forms exactly as they are coded today, expressed as data.
 *
 * The keys match the draft the workspace already keeps, so publishing this
 * changes nothing an officer sees — it moves the definition somewhere an admin
 * can edit it. Every later version is a diff against this one.
 *
 * A university and a lender get separate documents rather than one form with
 * conditional fields, because the two are different forms: an admission has a
 * tuition figure and a scholarship share, a loan has a rate and a tenure, and
 * nothing useful is shared beyond the course and the deadline.
 */

const field = (
  key: string,
  label: string,
  type: FormFieldDef['type'],
  order: number,
  extra: Partial<FormFieldDef> = {}
): FormFieldDef => ({
  key,
  label,
  type,
  order,
  required: false,
  enabled: true,
  ...extra
});

/** Organisation forms write into the offer or product record, not a profile column. */
const section = (
  key: string,
  label: string,
  description: string,
  column: string,
  fields: FormFieldDef[]
): FormSectionDef => ({ key, label, description, route: '', column, order: 1, enabled: true, fields });

// ── The invitation an officer sends a student ───────────────────────────────

const UNIVERSITY_OFFER: FormSchemaDef = {
  variant: 'UNIVERSITY',
  label: 'University invitation',
  sections: [
    section('offerTerms', 'Offer terms', 'Who the invitation is for and what it offers', 'offer', [
      field('student', 'Student', 'select', 1, { required: true, optionsSource: 'org:students' }),
      field('course', 'Course', 'select', 2, { required: true, optionsSource: 'org:products' }),
      field('scholarship', 'Scholarship', 'text', 3, { placeholder: 'e.g. 40% tuition scholarship' }),
      field('tuition', 'Tuition fee', 'text', 4, { required: true, placeholder: 'e.g. CAD 42,000 / year' }),
      field('accommodation', 'Accommodation', 'text', 5, { placeholder: 'e.g. Campus residence available' }),
      /** No conditions input here: the coded university block has never drawn one.
       *  An admin who wants it adds it, and it renders like any added field. */
      field('deadline', 'Response deadline', 'date', 6, {
        required: true,
        helpText: 'After this the offer expires and the student can no longer respond.'
      })
    ])
  ]
};

const BANK_OFFER: FormSchemaDef = {
  variant: 'BANK',
  label: 'Lender invitation',
  sections: [
    section('offerTerms', 'Offer terms', 'Who the invitation is for and what it offers', 'offer', [
      field('student', 'Student', 'select', 1, { required: true, optionsSource: 'org:students' }),
      field('course', 'Course being financed', 'text', 2, { required: true, placeholder: 'e.g. MSc Data Science' }),
      field('productName', 'Loan product', 'select', 3, { optionsSource: 'org:products' }),
      field('offerType', 'Offer type', 'select', 4, { options: ['PreApproved', 'Final'] }),
      field('loanAmount', 'Loan amount', 'text', 5, { required: true, placeholder: 'e.g. ₹38,00,000' }),
      field('interestRate', 'Interest rate', 'text', 6, { required: true, placeholder: 'e.g. 9.4% p.a.' }),
      /** Only a final offer quotes these, hence the condition on offer type. */
      field('emi', 'EMI', 'text', 7, { placeholder: 'e.g. ₹44,200 / month', visibleWhen: { field: 'offerType', equals: ['Final'] } }),
      field('processingFee', 'Processing fee', 'text', 8, { placeholder: 'e.g. 1% waived', visibleWhen: { field: 'offerType', equals: ['Final'] } }),
      field('tenure', 'Repayment tenure', 'text', 9, { required: true, placeholder: 'e.g. 10 years', visibleWhen: { field: 'offerType', equals: ['Final'] } }),
      field('conditions', 'Conditions', 'text', 10, { placeholder: 'e.g. Subject to guarantor verification' }),
      field('deadline', 'Response deadline', 'date', 11, {
        required: true,
        helpText: 'After this the offer expires and the student can no longer respond.'
      })
    ])
  ]
};


// ── The product catalogue ───────────────────────────────────────────────────

const productSchema = (variant: string, label: string, nameLabel: string): FormSchemaDef => ({
  variant,
  label,
  sections: [
    section('productDetails', 'Product details', 'One entry in your catalogue', 'product', [
      field('category', 'Category', 'select', 1, {
        required: true,
        optionsSource: 'org:categories',
        helpText: 'Grouped by this in the catalogue.'
      }),
      field('name', nameLabel, 'text', 2, { required: true }),
      field('url', 'Link', 'text', 3, { placeholder: 'https://', helpText: 'Where a student can read more.' })
    ])
  ]
});

// ── The short product invitation ────────────────────────────────────────────

const productInviteSchema = (variant: string, label: string): FormSchemaDef => ({
  variant,
  label,
  sections: [
    section('productInvite', 'Product invitation', 'Invite a student to named products', 'invite', [
      field('productNames', 'Products', 'multiselect', 1, {
        required: true,
        optionsSource: 'org:products',
        helpText: 'Pick from your catalogue.'
      }),
      field('conditions', 'Note to the student', 'textarea', 2, { wide: true })
    ])
  ]
});

const BUILT_IN: Record<string, Record<string, FormSchemaDef>> = {
  ORG_OFFER: {
    UNIVERSITY: UNIVERSITY_OFFER,
    BANK: BANK_OFFER,
  },
  ORG_PRODUCT: {
    UNIVERSITY: productSchema('UNIVERSITY', 'University catalogue entry', 'Course name'),
    BANK: productSchema('BANK', 'Lender catalogue entry', 'Product name'),
  },
  ORG_PRODUCT_INVITE: {
    UNIVERSITY: productInviteSchema('UNIVERSITY', 'University product invitation'),
    BANK: productInviteSchema('BANK', 'Lender product invitation'),
  }
};

/**
 * A deep copy of exactly the form asked for, so a caller editing a draft never
 * mutates the seed. Returns null rather than substituting a neighbouring
 * variant: quietly handing back the university form when a lender was asked for
 * is how an officer ends up filling in a tuition fee for a loan.
 */
export const cloneOrgSchema = (formKey: FormKey, variant: string): FormSchemaDef | null => {
  const found = BUILT_IN[formKey]?.[variant];
  return found ? (JSON.parse(JSON.stringify(found)) as FormSchemaDef) : null;
};
