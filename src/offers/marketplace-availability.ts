import { OfferCategory } from '@prisma/client';

/**
 * Which market an offer belongs to, and therefore which slot it fills.
 *
 * A seat and the money for it are found separately: accepting a place says
 * nothing about whether the fees are covered, and arranging a loan says nothing
 * about where the student is going. A scholarship is neither — it neither seats
 * anybody nor replaces a loan — so it closes no market, and a consultancy offer
 * places nobody either.
 */
export const AVAILABILITY_FIELD: Partial<Record<OfferCategory, 'admissionStatus' | 'financeStatus'>> = {
  UNIVERSITY: 'admissionStatus',
  BANK: 'financeStatus'
};

export type Availability = 'OPEN' | 'PLACED';

/** The slot this offer closes when accepted, or null when it closes none. */
export const availabilityFieldFor = (category: OfferCategory) => AVAILABILITY_FIELD[category] ?? null;

/**
 * What the student's own decisions add up to, recomputed rather than toggled.
 *
 * A student can hold several offers in one market. Deriving the answer from all
 * of them means withdrawing one accepted place cannot reopen a market they are
 * still committed to through another, which a simple flip would get wrong.
 */
export const availabilityFrom = (
  offers: { category: OfferCategory; studentDecision: string; status: string }[],
  field: 'admissionStatus' | 'financeStatus'
): Availability => {
  const placed = offers.some(
    offer =>
      availabilityFieldFor(offer.category) === field &&
      offer.studentDecision === 'ACCEPTED' &&
      offer.status !== 'WITHDRAWN' &&
      offer.status !== 'EXPIRED'
  );
  return placed ? 'PLACED' : 'OPEN';
};
