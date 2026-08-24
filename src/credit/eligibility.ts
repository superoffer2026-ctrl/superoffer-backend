/**
 * Whether a co-applicant can carry an education loan, and for how much.
 *
 * This is a screening estimate, not an underwriting decision — it exists so a
 * lender can see which candidates are worth inviting, and so a family is not
 * encouraged toward a loan that will be refused. Every lender re-runs its own
 * policy before it commits, which is why nothing here is presented as approval.
 */

export interface EligibilityInput {
  monthlyIncome: number;
  existingEmi: number;
  employmentType: string;
  /** A band such as "750-799", or absent when nothing has been pulled. */
  band?: string | null;
  /** SCORED, NO_HISTORY, and so on — a thin file is not the same as a bad one. */
  outcome?: string | null;
  /** What the course actually costs, when it is known. */
  amountNeeded?: number;
}

export interface EligibilityResult {
  /** LIKELY, POSSIBLE, UNLIKELY, or UNKNOWN when there is too little to say. */
  verdict: 'LIKELY' | 'POSSIBLE' | 'UNLIKELY' | 'UNKNOWN';
  /** Monthly repayment the household could take on, after what they already owe. */
  affordableEmi: number;
  /** Indicative principal at a typical education-loan rate and term. */
  indicativeAmount: number;
  /** What share of income already goes to repayments. */
  obligationRatio: number;
  /** Plain-English reasons, in the order they matter. */
  reasons: string[];
}

/**
 * The share of monthly income a lender will let total repayments reach.
 *
 * Indian education lenders commonly work to about half; a household already at
 * that level has nothing left to service a new loan.
 */
const MAX_OBLIGATION_RATIO = 0.5;

/** Typical education-loan terms, used only to turn an affordable EMI into a principal. */
const ANNUAL_RATE = 0.105;
const TERM_MONTHS = 120;

/** Standard amortisation: what principal an affordable monthly payment supports. */
const principalFor = (emi: number): number => {
  if (emi <= 0) return 0;
  const monthlyRate = ANNUAL_RATE / 12;
  return Math.round((emi * (1 - Math.pow(1 + monthlyRate, -TERM_MONTHS))) / monthlyRate);
};

/** Bands a lender will usually work with, roughly in order of comfort. */
const STRONG_BANDS = new Set(['800-900', '750-799']);
const FAIR_BANDS = new Set(['700-749', '650-699']);

export function assessEligibility(input: EligibilityInput): EligibilityResult {
  const income = Math.max(0, Number(input.monthlyIncome) || 0);
  const existing = Math.max(0, Number(input.existingEmi) || 0);
  const reasons: string[] = [];

  if (!income) {
    return {
      verdict: 'UNKNOWN',
      affordableEmi: 0,
      indicativeAmount: 0,
      obligationRatio: 0,
      reasons: ['No co-applicant income recorded yet']
    };
  }

  const obligationRatio = Math.min(1, existing / income);
  const affordableEmi = Math.max(0, Math.round(income * MAX_OBLIGATION_RATIO - existing));
  const indicativeAmount = principalFor(affordableEmi);

  if (!affordableEmi) {
    reasons.push('Existing repayments already use the income a lender would count on');
    return { verdict: 'UNLIKELY', affordableEmi: 0, indicativeAmount: 0, obligationRatio, reasons };
  }

  /**
   * No credit history is the normal state for someone who has never borrowed.
   * It is reported as an unknown rather than a mark against them, because
   * treating it as a negative would penalise exactly the families this is for.
   */
  if (input.outcome === 'NO_HISTORY') {
    reasons.push('No credit history — a lender will want documents rather than a score');
    return { verdict: 'POSSIBLE', affordableEmi, indicativeAmount, obligationRatio, reasons };
  }

  if (!input.band) {
    reasons.push('No credit check has been run yet');
    return { verdict: 'UNKNOWN', affordableEmi, indicativeAmount, obligationRatio, reasons };
  }

  if (obligationRatio > 0.35) {
    reasons.push(`Existing repayments take ${Math.round(obligationRatio * 100)}% of monthly income`);
  }

  const shortfall = input.amountNeeded && input.amountNeeded > indicativeAmount;
  if (shortfall) {
    reasons.push('The course costs more than this income supports on its own');
  }

  if (STRONG_BANDS.has(input.band)) {
    reasons.unshift('Credit history is strong');
    return {
      verdict: shortfall || obligationRatio > 0.35 ? 'POSSIBLE' : 'LIKELY',
      affordableEmi,
      indicativeAmount,
      obligationRatio,
      reasons
    };
  }

  if (FAIR_BANDS.has(input.band)) {
    reasons.unshift('Credit history is workable but not strong');
    return { verdict: 'POSSIBLE', affordableEmi, indicativeAmount, obligationRatio, reasons };
  }

  reasons.unshift('Credit history is below what most lenders accept unsecured');
  reasons.push('Collateral or a second co-applicant would usually be needed');
  return { verdict: 'UNLIKELY', affordableEmi, indicativeAmount, obligationRatio, reasons };
}
