/**
 * What a credit look-up needs, what it returns, and who was allowed to ask.
 *
 * The provider is behind an interface because the entitlement question — whose
 * bureau membership a pull runs under — is a commercial arrangement, not a code
 * decision. A stub, a consumer self-pull and a bank-credentialled pull all fit
 * the same shape, so the rest of the product does not change when that settles.
 */

export type CreditCheckKind = 'SELF_PULL' | 'LENDER_PULL';

/** A self-pull is a soft enquiry; only a lender's own look-up is hard. */
export type EnquiryType = 'SOFT' | 'HARD';

export type CreditOutcome = 'SCORED' | 'NO_HISTORY' | 'IDENTITY_MISMATCH' | 'PROVIDER_ERROR';

/** Exactly what a bureau needs to identify a person, and nothing more. */
export interface CreditSubject {
  name: string;
  /** Decrypted only for the moment of the call, never returned to a browser. */
  pan: string;
  dateOfBirth: string;
  mobileNumber: string;
}

export interface CreditPullRequest {
  subject: CreditSubject;
  kind: CreditCheckKind;
  /**
   * The bank's own bureau membership, when the pull runs under their
   * entitlement. Absent for a self-pull, which needs none.
   */
  membership?: {
    memberId: string;
    /** Where the certificate actually lives. The material never passes through here. */
    secretRef: string;
  };
}

export interface CreditPullResult {
  outcome: CreditOutcome;
  /** A band such as "750-799". Absent unless the outcome is SCORED. */
  band?: string;
  enquiry: EnquiryType;
  /** The provider's identifier, so a dispute can be traced without holding the report. */
  providerRef?: string;
  provider: string;
  /** Why there is no band, in words a person can act on. */
  detail?: string;
}

export interface CreditBureauProvider {
  readonly name: string;
  pull(request: CreditPullRequest): Promise<CreditPullResult>;
}

/**
 * The bands a score is reported in.
 *
 * Discovery shows a band rather than a number: it is all an officer needs to
 * decide whether to invite, and it keeps an exact score — which is the bureau's
 * to disclose, under their contract — out of this database.
 */
export const CREDIT_BANDS: Array<{ band: string; from: number; to: number; reads: string }> = [
  { band: '800-900', from: 800, to: 900, reads: 'Excellent' },
  { band: '750-799', from: 750, to: 799, reads: 'Strong' },
  { band: '700-749', from: 700, to: 749, reads: 'Good' },
  { band: '650-699', from: 650, to: 699, reads: 'Fair' },
  { band: '550-649', from: 550, to: 649, reads: 'Weak' },
  { band: '300-549', from: 300, to: 549, reads: 'Poor' }
];

export const bandFor = (score: number): string =>
  CREDIT_BANDS.find(entry => score >= entry.from && score <= entry.to)?.band || '300-549';

/** How long a band is treated as current before the panel asks for a refresh. */
export const BAND_FRESH_DAYS = 90;

/** How long a consent stands before it has to be given again. */
export const CONSENT_VALID_DAYS = 180;
