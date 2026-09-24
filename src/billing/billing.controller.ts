import { AdminKeyGuard } from '../admin/admin-key.guard';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Organization } from '@prisma/client';
import { ApprovedOrganizationGuard } from '../auth/approved-organization.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BillingService } from './billing.service';

/**
 * What an organisation can see about its own subscription: everything, and
 * nothing it can change. Plans are sold offline, so the price, the period and
 * the payment are all recorded by our team — an organisation reading this page
 * is reading a statement, not a shop.
 */
@ApiTags('organization-billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ApprovedOrganizationGuard)
@Roles('UNIVERSITY_OFFICER', 'LOAN_OFFICER')
@Controller('organizations/me/billing')
export class OrganizationBillingController {
  constructor(private billing: BillingService) {}

  @Get()
  async read(@Req() request: { organization: Organization }) {
    const organization = request.organization;
    return {
      subscription: await this.billing.entitlement(organization),
      invoices: await this.billing.invoicesFor(organization.id)
    };
  }
}

/** Selling, invoicing and chasing — all of it by hand, all of it recorded. */
@ApiTags('admin-billing')
@ApiHeader({ name: 'x-admin-key', required: true })
@UseGuards(AdminKeyGuard)
@Controller('admin/billing')
export class AdminBillingController {
  constructor(private billing: BillingService) {}

  @Get()
  overview() {
    return this.billing.overview();
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body()
    body: {
      organizationId: string; plan: string; periodStart: string; periodEnd: string;
      amount: number; currency?: string; note?: string;
    }
  ) {
    return this.billing.createSubscription(body);
  }

  /** The money arrived offline; this is where it is written down. */
  @Post('subscriptions/:id/paid')
  @HttpCode(HttpStatus.OK)
  markPaid(@Param('id') id: string, @Body() body: { paymentRef?: string; recordedBy?: string; paidAt?: string }) {
    return this.billing.markPaid(id, body || {});
  }

  @Patch('subscriptions/:id')
  setStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.billing.setStatus(id, body?.status);
  }

  /**
   * Switching an organisation off, or back on.
   *
   * Never automatic. An overdue invoice raises a warning and a person decides,
   * because cutting off a customer over a slow transfer costs more than the bill.
   */
  @Post('organizations/:organizationId/suspension')
  @HttpCode(HttpStatus.OK)
  suspend(
    @Param('organizationId') organizationId: string,
    @Body() body: { suspended: boolean; reason?: string }
  ) {
    return this.billing.setSuspension(organizationId, !!body?.suspended, body?.reason);
  }
}
