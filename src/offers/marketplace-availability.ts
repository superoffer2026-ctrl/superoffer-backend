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

/**
 * Accepting an invite no longer closes a market.
 *
 * `availabilityFrom` used to derive PLACED from any accepted offer, which made
 * one acceptance a global, exclusive commitment: the student vanished from
 * every other university's search and could not be opened by one that had not
 * already engaged them. That is not what accepting means here. A student may
 * hold invites from five universities and two lenders and be genuinely
 * proceeding with several at once — each acceptance is a relationship with that
 * one organisation, not a decision about the others.
 *
 * What does take a student out of the market is a *confirmed* admission, which
 * is a later and different event: the university says the student actually
 * enrolled, and `AdmissionsService` moves them to the ALUMNI segment with
 * `discoverable: false`. That is the only exclusive step, and it is not the
 * student clicking Accept.
 *
 * The columns and their indexes stay. They remain the switch the discovery
 * filter reads, so an explicit "stop putting me in front of universities"
 * control has somewhere to write — it is simply no longer written by an
 * acceptance.
 */
