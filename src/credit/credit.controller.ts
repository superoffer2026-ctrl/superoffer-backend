import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApprovedOrganizationGuard } from '../auth/approved-organization.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SchemaValidatorService } from '../forms/schema-validator.service';
import type { Organization } from '@prisma/client';
import { CreditService } from './credit.service';
import { assessEligibility } from './eligibility';

/** The wording a co-applicant agrees to. Kept with the consent, verbatim. */
const SELF_STATEMENT =
  'I agree that SuperOffer may check my credit record to show me which education loans I am likely to qualify for. ' +
  'This is a soft enquiry and does not affect my credit score.';

const LENDER_STATEMENT =
  'I agree that this lender may check my credit record to assess an education loan for my child. ' +
  'This is a formal enquiry and will appear on my credit report.';

/**
 * The co-applicant's details and the credit checks they permit.
 *
 * A PAN goes in and never comes back: every response here carries the masked
 * form. The exact score is not returned either — a band is what a decision to
 * invite needs, and the full report belongs to whoever is entitled to hold it.
 */
@ApiTags('student-credit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
@Controller('students/me')
export class StudentCreditController {
  constructor(private credit: CreditService, private schema: SchemaValidatorService) {}

  @Get('co-applicant')
  read(@CurrentUser() user: AuthenticatedUser) {
    return this.credit.readCoApplicant(user.id);
  }

  @Put('co-applicant')
  async save(@CurrentUser() user: AuthenticatedUser, @Req() request: { body: Record<string, unknown> }) {
    /** The published form decides what is asked for and what is required. */
    const payload = await this.schema.mergeAndValidate('coApplicant', {}, request.body);
    return this.credit.saveCoApplicant(user.id, payload);
  }

  /** What a lender would make of this household, before anyone has been invited. */
  @Get('loan-eligibility')
  async eligibility(@CurrentUser() user: AuthenticatedUser) {
    const coApplicant = await this.credit.readCoApplicant(user.id);
    const check = await this.credit.latestCheck(user.id);

    return {
      coApplicant,
      check: check && { band: check.band, outcome: check.outcome, pulledAt: check.pulledAt, staleAfter: check.staleAfter },
      eligibility: assessEligibility({
        monthlyIncome: Number(coApplicant?.monthlyIncome) || 0,
        existingEmi: Number(coApplicant?.existingEmi) || 0,
        employmentType: String(coApplicant?.employmentType || ''),
        band: check?.band,
        outcome: check?.outcome
      })
    };
  }

  @Get('credit-consents')
  async consents(@CurrentUser() user: AuthenticatedUser) {
    return { consents: await this.credit.consentsFor(user.id) };
  }

  /**
   * The co-applicant agreeing to a check of their own record.
   *
   * A soft enquiry, so it costs them nothing, and it is what lets a lender see a
   * band while browsing rather than pulling a hard enquiry on a guess.
   */
  @Post('credit-consents/self')
  @HttpCode(HttpStatus.CREATED)
  grantSelf(@CurrentUser() user: AuthenticatedUser, @Req() request: { ip?: string }) {
    return this.credit.grantConsent(user.id, {
      kind: 'SELF_PULL',
      purpose: 'Show which education loans this family is likely to qualify for',
      statement: SELF_STATEMENT,
      ip: request.ip
    });
  }

  /** Agreeing that one named lender may run its own formal check. */
  @Post('credit-consents/lender/:organizationId')
  @HttpCode(HttpStatus.CREATED)
  grantLender(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Req() request: { ip?: string }
  ) {
    return this.credit.grantConsent(user.id, {
      kind: 'LENDER_PULL',
      organizationId,
      purpose: 'Assess an education loan application',
      statement: LENDER_STATEMENT,
      ip: request.ip
    });
  }

  @Delete('credit-consents/:id')
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.credit.revokeConsent(user.id, id);
  }

  /** Runs the soft check the co-applicant has agreed to. */
  @Post('credit-check')
  @HttpCode(HttpStatus.OK)
  check(@CurrentUser() user: AuthenticatedUser) {
    return this.credit.runCheck(user.id, 'SELF_PULL', { actorUserId: user.id });
  }
}

/** The lender's own check, run under their bureau membership. */
@ApiTags('organization-credit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ApprovedOrganizationGuard)
@Roles('LOAN_OFFICER')
@Controller('organizations/me')
export class OrganizationCreditController {
  constructor(private credit: CreditService) {}

  @Post('students/:studentUserId/credit-check')
  @HttpCode(HttpStatus.OK)
  run(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: { organization: Organization },
    @Param('studentUserId') studentUserId: string,
    @Body() body: { acknowledgeHardEnquiry?: boolean }
  ) {
    /**
     * A hard enquiry marks the co-applicant's report, so it is never a side
     * effect of opening a page — the officer has to say they meant it.
     */
    if (!body?.acknowledgeHardEnquiry) {
      return {
        code: 'HARD_ENQUIRY_NOT_ACKNOWLEDGED',
        message:
          'A lender check is a formal enquiry and will appear on the co-applicant credit report. ' +
          'Confirm before running it.'
      };
    }

    return this.credit.runCheck(studentUserId, 'LENDER_PULL', {
      organizationId: request.organization.id,
      actorUserId: user.id
    });
  }
}
