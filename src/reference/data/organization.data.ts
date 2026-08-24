/**
 * Organization-side reference data: the offer-condition presets an officer can insert
 * into an invitation, the subscription tiers, and the bank evaluation modes.
 *
 * Moved out of the frontend so the workspace renders what the server serves.
 */

export interface ConditionPreset {
  cat: string;
  text: string;
}

export const OFFER_CONDITION_PRESETS: ConditionPreset[] = [
    { cat: 'Application', text: "Use code [CODE] for a full waiver on your application fee." },
    { cat: 'Application', text: "Use code [CODE] for [PERCENT]% off your application fee." },
    { cat: 'Application', text: "Use code [CODE] for [AMOUNT] off your application fee." },
    { cat: 'Tuition', text: "This invitation comes with a full tuition scholarship." },
    { cat: 'Tuition', text: "Based on your profile, a [PERCENT]% tuition scholarship upon admission." },
    { cat: 'Tuition', text: "Based on your profile, a tuition scholarship of [AMOUNT] upon admission." },
    { cat: 'Tuition', text: "This invitation makes you eligible for the reduced in-state tuition rate." },
    { cat: 'Tuition', text: "A scholarship covering [PERCENT]% of tuition across all years." },
    { cat: 'Accommodation', text: "A [PERCENT]% discount on first-year accommodation fees." },
    { cat: 'Accommodation', text: "This invitation comes with fully subsidized on-campus accommodation." },
    { cat: 'Accommodation', text: "A monthly living stipend of [AMOUNT]." },
    { cat: 'Competitive Test', text: "The [Exam] requirement waived for this product." },
    { cat: 'English Proficiency', text: "The [Exam] requirement waived based on your academic background." },
    { cat: 'Admission', text: "Priority/fast-track review, with a decision within [DAYS] days." },
    { cat: 'RA/TA', text: "A Research/Teaching Assistantship, including a tuition waiver and monthly stipend of [AMOUNT]." },
    { cat: 'Placement', text: "A guaranteed on-campus work-study position for up to [HOURS] hours/week." },
    { cat: 'Placement', text: "A guaranteed internship placement through our industry partners." },
    { cat: 'Interest Rate', text: "A reduced interest rate of [RATE]% p.a. on your education loan." },
    { cat: 'Interest Rate', text: "Your interest rate locked at [RATE]% for the full loan tenure, protected from future hikes." },
    { cat: 'Processing Charges', text: "A full waiver on your loan processing fee." },
    { cat: 'Processing Charges', text: "Use code [CODE] for [PERCENT]% off your loan processing fee." },
    { cat: 'Processing Charges', text: "A full waiver on loan documentation charges." },
    { cat: 'Processing Charges', text: "Complimentary loan protection/insurance cover, with the premium waived." },
    { cat: 'Collateral', text: "Eligibility for an unsecured loan with no collateral required, up to [AMOUNT]." },
    { cat: 'Co-Applicant/Guarantor', text: "Eligibility for a loan without a co-applicant/guarantor." },
    { cat: 'Repayment Terms', text: "An extended moratorium period of [MONTHS] months after course completion before repayment begins." },
    { cat: 'Repayment Terms', text: "A flexible repayment tenure of up to [YEARS] years." },
    { cat: 'Repayment Terms', text: "An EMI holiday of [MONTHS] months in case of financial hardship during repayment." },
    { cat: 'Repayment Terms', text: "An interest-only repayment option during your study period, deferring principal repayment." },
    { cat: 'Higher Loan Coverage', text: "Loan coverage of up to [PERCENT]% of your total cost of attendance, including tuition, living, and travel." },
    { cat: 'Risk Protection', text: "Complimentary cover that pauses EMIs for up to [MONTHS] months in case of job loss." },
    { cat: 'Risk Protection', text: "Loan waiver for the borrower in case of death or permanent disability during the loan tenure." },
    { cat: 'Risk Protection', text: "Protection against currency fluctuation on your loan amount during disbursement." }
  ];

export const SUBSCRIPTION_PLAN_OPTIONS = [
    {name:'Basic',profiles:'50',recommended:false,features:['Core student search','Save student profiles','Create offers','Team management'],unlocks:[] as string[]},
    {name:'Professional',profiles:'200',recommended:true,features:['Everything in Basic'],unlocks:['Advanced Filters','Priority Discovery']},
    {name:'Enterprise',profiles:'Unlimited',recommended:false,features:['Everything in Professional'],unlocks:['Advanced Filters','Priority Discovery','AI Recommendations']}
  ];

export const BANK_EVALUATION_MODE_OPTIONS = [
    { value: 'ACADEMIC_ONLY', label: 'Academic Profile Only', description: 'Pre-approve students before admission, based on academic and financial profile alone.' },
    { value: 'UNIVERSITY_OFFER_ONLY', label: 'University Offer Only', description: 'Only evaluate students who already hold at least one university offer.' },
    { value: 'ACADEMIC_AND_OFFER', label: 'Academic + University Offer', description: 'See every student. Pre-approve on academics, then upgrade to a final loan offer once admitted.' }
  ];
