import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreditBureauProvider, CreditPullRequest, CreditPullResult, bandFor } from './credit.types';

/**
 * Sandbox unless SUREPASS_BASE_URL says otherwise. Going live is the same
 * contract behind a different host, so it is configuration and not code:
 * set SUREPASS_BASE_URL to the production host and SUREPASS_TOKEN to the
 * production token, and redeploy.
 */
const DEFAULT_BASE_URL = 'https://sandbox.surepass.app';
const SCORE_PATH = '/api/v1/credit-report-cibil/score';
const REQUEST_TIMEOUT_MS = 20_000;

/** CIBIL reports in this range; anything outside it is not a score. */
const MIN_SCORE = 300;
const MAX_SCORE = 900;

/**
 * SurePass, the bureau connector behind every CIBIL look-up.
 *
 * The token lives in the backend environment and is read here, at the one place
 * that talks to SurePass — it is never returned in a response, never logged, and
 * has no `NEXT_PUBLIC_` twin, so a browser has no way to reach it. What the
 * browser gets back is the score and nothing else about the call.
 *
 * Every failure is mapped onto a `CreditOutcome` rather than thrown, because the
 * attempt is recorded either way: a bureau contract asks who tried, not only who
 * succeeded, and a student is owed a reason they can act on.
 */
@Injectable()
export class SurePassProvider implements CreditBureauProvider, OnModuleInit {
  readonly name = 'surepass';
  private readonly logger = new Logger(SurePassProvider.name);

  constructor(private config: ConfigService) {}

  /**
   * Says at boot which bureau host this deployment talks to and whether it can
   * talk at all — the host and a yes/no, never the token. A deploy pointed at
   * the wrong environment, or one that forgot the token, shows up in the first
   * lines of the log rather than in a student's failed check.
   */
  onModuleInit() {
    const host = this.baseUrl;
    const stage = host === DEFAULT_BASE_URL ? 'sandbox' : 'custom host';
    const credentials = this.token ? 'token configured' : 'NO TOKEN — credit checks will fail until SUREPASS_TOKEN is set';
    this.logger.log(`Credit bureau: SurePass ${stage} (${host}), ${credentials}`);
  }

  /** Sandbox today; the live host is the same contract behind a different base URL. */
  private get baseUrl(): string {
    return (this.config.get<string>('SUREPASS_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private get token(): string {
    return (this.config.get<string>('SUREPASS_TOKEN') || '').trim();
  }

  async pull(request: CreditPullRequest): Promise<CreditPullResult> {
    const { subject, kind } = request;
    const enquiry = kind === 'LENDER_PULL' ? 'HARD' : 'SOFT';
    const fail = (detail: string, outcome: CreditPullResult['outcome'] = 'PROVIDER_ERROR'): CreditPullResult => ({
      outcome,
      enquiry,
      provider: this.name,
      detail
    });

    if (!this.token) {
      /** Configuration, not the student's problem — say so without naming the variable to a browser. */
      this.logger.error('SUREPASS_TOKEN is not set; no credit check can run');
      return fail('Credit checks are not available right now. Please try again later.');
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${SCORE_PATH}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          pan: subject.pan.toUpperCase(),
          mobile: subject.mobileNumber,
          name: subject.name,
          /** Recorded as a consent row before this call is made; SurePass wants it restated. */
          consent: 'Y',
          gender: subject.gender
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`SurePass request failed: ${reason}`);
      return fail('Could not reach the credit bureau. Please try again in a moment.');
    }

    const payload = (await response.json().catch(() => null)) as SurePassResponse | null;

    if (!response.ok || payload?.success === false) {
      const message = payload?.message || payload?.message_code || `HTTP ${response.status}`;
      this.logger.warn(`SurePass refused a look-up: ${response.status} ${message}`);

      /**
       * Status first, and only then the wording. SurePass says "Your token is
       * invalid" for a credentials failure, which a message-shaped test reads as
       * an identity problem — telling the student their own PAN is wrong when
       * nothing about them is.
       */
      /**
       * An exhausted balance also comes back 403, and reads as a credentials
       * failure unless the message is looked at — which sends whoever is on call
       * hunting for a bad token when the account simply needs topping up.
       */
      if (/balance|recharge|quota|insufficient|credits?/i.test(String(message))) {
        this.logger.error(`SurePass account cannot serve requests: ${message}`);
        return fail('Credit checks are temporarily unavailable. Please try again later.');
      }
      if (response.status === 401 || response.status === 403) {
        this.logger.error('SurePass rejected the configured credentials');
        return fail('Credit checks are not available right now. Please try again later.');
      }
      if (response.status === 429) {
        return fail('Too many credit checks just now. Please try again in a few minutes.');
      }
      /** A bureau that cannot match the person is a different answer from one that broke. */
      if (response.status === 422 || /no\s*record|not\s*found|mismatch/i.test(String(message))) {
        return fail(
          'Those details did not match any credit record. Check the PAN, name and mobile number are exactly as registered.',
          'IDENTITY_MISMATCH'
        );
      }
      return fail('The credit bureau could not complete this check. Please try again in a moment.');
    }

    const raw = payload?.data?.credit_score;
    const score = Number(String(raw ?? '').trim());

    if (!raw || !Number.isFinite(score)) {
      /** A thin file scores nothing, which is normal for someone who has never borrowed. */
      return {
        outcome: 'NO_HISTORY',
        enquiry,
        provider: this.name,
        providerRef: payload?.data?.client_id,
        detail: 'No credit history found. This is normal for someone who has never borrowed.'
      };
    }

    if (score < MIN_SCORE || score > MAX_SCORE) {
      this.logger.warn(`SurePass returned a score outside ${MIN_SCORE}-${MAX_SCORE}`);
      return fail('The credit bureau returned a score that could not be read. Please try again.');
    }

    return {
      outcome: 'SCORED',
      score,
      band: bandFor(score),
      enquiry,
      providerRef: payload?.data?.client_id,
      provider: this.name
    };
  }
}

/** Only the fields this integration reads. SurePass returns more; none of it is stored. */
interface SurePassResponse {
  success?: boolean;
  message?: string;
  message_code?: string;
  data?: {
    credit_score?: string | number;
    client_id?: string;
  };
}
