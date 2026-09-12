import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req,
  UploadedFile, UseGuards, UseInterceptors
} from '@nestjs/common';
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
import { OfferTemplatesService, type OfferTemplateInput } from './offer-templates.service';
import { OrganizationsService } from './organizations.service';
import { imageUploadInterceptor } from '../media/media.upload';
import { LocalMediaStorage } from '../media/media.storage';

@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ApprovedOrganizationGuard)
@Roles('UNIVERSITY_OFFICER', 'LOAN_OFFICER', 'CONSULTANT')
@Controller('organizations/me')
export class OrganizationsController {
  constructor(
    private organizations: OrganizationsService,
    private discovery: DiscoveryService,
    private templates: OfferTemplatesService,
    private media: LocalMediaStorage
  ) {}

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

  /**
   * The organisation's own logo and cover, and a programme's image.
   *
   * Uploaded by the organisation itself: once an admin has approved them, what
   * they look like and what they teach is theirs to maintain, not ours to
   * research. The interceptor stages the file; the storage layer decides where
   * it finally lives and hands back an opaque reference.
   */
  @Post('logo')
  @UseInterceptors(imageUploadInterceptor())
  async uploadLogo(@Req() request: { organization: Organization }, @UploadedFile() file?: Express.Multer.File) {
    return this.saveImage(request.organization.id, 'logoRef', file);
  }

  @Post('cover')
  @UseInterceptors(imageUploadInterceptor())
  async uploadCover(@Req() request: { organization: Organization }, @UploadedFile() file?: Express.Multer.File) {
    return this.saveImage(request.organization.id, 'coverRef', file);
  }

  @Post('products/:id/image')
  @UseInterceptors(imageUploadInterceptor())
  async uploadProductImage(
    @Req() request: { organization: Organization },
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File
  ) {
    if (!file) throw new BadRequestException({ code: 'NO_FILE', message: 'Choose an image to upload' });
    const ref = await this.media.keep(file.path, 'programs', file.originalname);
    const product = await this.organizations.setProductImage(request.organization.id, id, ref);
    return { imageUrl: this.media.urlFor(product.imageRef) };
  }

  private async saveImage(organizationId: string, field: 'logoRef' | 'coverRef', file?: Express.Multer.File) {
    if (!file) throw new BadRequestException({ code: 'NO_FILE', message: 'Choose an image to upload' });
    const folder = field === 'logoRef' ? 'logos' : 'covers';
    const ref = await this.media.keep(file.path, folder, file.originalname);
    const organization = await this.organizations.setOrganizationImage(organizationId, field, ref);
    return { logoUrl: this.media.urlFor(organization.logoRef), coverUrl: this.media.urlFor(organization.coverRef) };
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

  // ── The offers a product is prepared to make ─────────────────────────────

  /**
   * Every template this organisation has, so the products page can show them.
   * `?archived=1` asks for the ones put away, which the archive drawer lists.
   */
  @Get('offer-templates')
  allTemplates(@Req() request: { organization: Organization }, @Query('archived') archived?: string) {
    return this.templates.listAll(request.organization, archived === '1' || archived === 'true');
  }

  @Get('products/:productId/templates')
  templatesFor(@Req() request: { organization: Organization }, @Param('productId') productId: string) {
    return this.templates.list(request.organization, productId);
  }

  @Post('products/:productId/templates')
  createTemplate(
    @Req() request: { organization: Organization },
    @Param('productId') productId: string,
    @Body() body: OfferTemplateInput
  ) {
    return this.templates.create(request.organization, productId, body);
  }

  @Patch('offer-templates/:id')
  updateTemplate(
    @Req() request: { organization: Organization },
    @Param('id') id: string,
    @Body() body: Partial<OfferTemplateInput>
  ) {
    return this.templates.update(request.organization, id, body);
  }

  /** Archived, not deleted: offers already sent on it still point here. */
  @Delete('offer-templates/:id')
  archiveTemplate(@Req() request: { organization: Organization }, @Param('id') id: string) {
    return this.templates.archive(request.organization, id);
  }

  /** The way back out of the archive, so "Archive" is not a delete in disguise. */
  @Post('offer-templates/:id/restore')
  restoreTemplate(@Req() request: { organization: Organization }, @Param('id') id: string) {
    return this.templates.restore(request.organization, id);
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
