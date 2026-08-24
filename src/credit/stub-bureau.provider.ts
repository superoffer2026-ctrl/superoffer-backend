import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  CreditBureauProvider,
  CreditPullRequest,
  CreditPullResult,
  bandFor
} from './credit.types';

/**
 * A stand-in bureau, so the whole flow — consent, identity match, banding,
 * eligibility, the lender's panel — can be built and tested before any bank
 * hands over a certificate.
 *
 * It is deterministic on the PAN, so the same person always comes back with the
 * same band and a test can assert on it. It also reproduces the two answers a
 * real bureau gives that are easy to forget: a thin file with no score at all,
 * which is normal for someone who has never borrowed, and an identity that does
 * not match.
 */
@Injectable()
export class StubBureauProvider implements CreditBureauProvider {
  readonly name = 'stub';

  async pull(request: CreditPullRequest): Promise<CreditPullResult> {
    const { subject, kind } = request;
    const enquiry = kind === 'LENDER_PULL' ? 'HARD' : 'SOFT';

    /** A name that cannot be matched to the PAN is the commonest real failure. */
    if (!subject.name?.trim()) {
      return {
        outcome: 'IDENTITY_MISMATCH',
        enquiry,
        provider: this.name,
        detail: 'The name on record did not match the PAN'
      };
    }

    const digest = crypto.createHash('sha256').update(subject.pan.toUpperCase()).digest();

    /** Roughly one in eight has never borrowed, so has no file to score. */
    if (digest[0] % 8 === 0) {
      return {
        outcome: 'NO_HISTORY',
        enquiry,
        provider: this.name,
        providerRef: `stub-${digest.toString('hex').slice(0, 12)}`,
        detail: 'No credit history found. This is normal for someone who has never borrowed.'
      };
    }

    /** 300-900 is the range CIBIL reports in. */
    const score = 300 + (digest.readUInt16BE(1) % 601);

    return {
      outcome: 'SCORED',
      band: bandFor(score),
      enquiry,
      providerRef: `stub-${digest.toString('hex').slice(0, 12)}`,
      provider: this.name
    };
  }
}
