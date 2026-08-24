import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Organization } from '@prisma/client';
import { ApprovedOrganizationGuard } from '../auth/approved-organization.guard';
import { AuthenticatedUser, CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DiscoveryService, StudentSearchFilters } from './discovery.service';
import {
  ImportProductsDto,
  OrganizationProfileDto,
  ProductDto,
  ShortlistDto,
  TeamInviteDto
} from './dto/organization.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ApprovedOrganizationGuard)
@Roles('UNIVERSITY_OFFICER', 'LOAN_OFFICER', 'CONSULTANT')
@Controller('organizations/me')
export class OrganizationsController {
  constructor(private organizations: OrganizationsService, private discovery: DiscoveryService) {}

  // ── Profile, criteria, subscription, notification preferences ─────────────

  @Get('profile')
  profile(@Req() request: { organization: Organization }) {
    return this.organizations.profile(request.organization);
  }

  @Patch('profile')
  updateProfile(@Req() request: { organization: Organization }, @Body() dto: OrganizationProfileDto) {
    return this.organizations.updateProfile(request.organization, dto);
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  @Get('students')
  students(@Req() request: { organization: Organization }, @Query() filters: StudentSearchFilters) {
    return this.discovery.search(request.organization, filters);
  }

  @Get('students/:id')
  student(@Req() request: { organization: Organization }, @Param('id') id: string) {
    return this.discovery.findOne(request.organization, id);
  }

  // ── Product catalog ───────────────────────────────────────────────────────

  @Get('products')
  products(@Req() request: { organization: Organization }) {
    return this.organizations.listProducts(request.organization.id);
  }

  @Post('products')
  createProduct(@Req() request: { organization: Organization }, @Body() dto: ProductDto) {
    return this.organizations.createProduct(request.organization.id, dto);
  }

  @Patch('products/:id')
  updateProduct(@Req() request: { organization: Organization }, @Param('id') id: string, @Body() dto: ProductDto) {
    return this.organizations.updateProduct(request.organization.id, id, dto);
  }

  @Delete('products/:id')
  archiveProduct(@Req() request: { organization: Organization }, @Param('id') id: string) {
    return this.organizations.archiveProduct(request.organization.id, id);
  }

  @Post('products/import')
  importProducts(@Req() request: { organization: Organization }, @Body() dto: ImportProductsDto) {
    return this.organizations.importProducts(request.organization.id, dto.products);
  }

  // ── Shortlist ─────────────────────────────────────────────────────────────

  @Get('shortlist')
  shortlist(@Req() request: { organization: Organization }) {
    return this.organizations.listShortlist(request.organization.id);
  }

  @Post('shortlist')
  addToShortlist(@Req() request: { organization: Organization }, @Body() dto: ShortlistDto) {
    return this.organizations.addToShortlist(request.organization.id, dto.studentUserId, dto.status);
  }

  @Delete('shortlist/:studentUserId')
  removeFromShortlist(@Req() request: { organization: Organization }, @Param('studentUserId') studentUserId: string) {
    return this.organizations.removeFromShortlist(request.organization.id, studentUserId);
  }

  // ── Team ──────────────────────────────────────────────────────────────────

  @Get('team')
  team(@Req() request: { organization: Organization }, @CurrentUser() user: AuthenticatedUser) {
    return this.organizations.listTeam(request.organization.id, user.id);
  }

  @Post('team')
  invite(
    @Req() request: { organization: Organization },
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TeamInviteDto
  ) {
    return this.organizations.inviteOfficer(request.organization, user.role, dto, user.id);
  }

  @Delete('team/:id')
  removeOfficer(
    @Req() request: { organization: Organization },
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string
  ) {
    return this.organizations.removeOfficer(request.organization.id, id, user.id);
  }
}
