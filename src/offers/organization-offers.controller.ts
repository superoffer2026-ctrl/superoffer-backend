import { Body, Controller, Get, Param, Post, Query, Req, UseGuards , Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { messageAttachmentInterceptor } from './message-attachment';
import type { MessageAttachment } from './offers.service';
import type { Organization } from '@prisma/client';
import { ApprovedOrganizationGuard } from '../auth/approved-organization.guard';
import { AuthenticatedUser, CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOfferDto, OfferMessageDto } from './dto/offer.dto';
import { OffersService } from './offers.service';

@ApiTags('organization-offers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ApprovedOrganizationGuard)
@Roles('UNIVERSITY_OFFICER', 'LOAN_OFFICER', 'CONSULTANT')
@Controller('organizations/me/offers')
export class OrganizationOffersController {
  constructor(private offers: OffersService, private prisma: PrismaService) {}

  @Get()
  list(@Req() request: { organization: Organization }, @Query('status') status?: string) {
    return this.offers.listForOrganization(request.organization.id, status);
  }

  @Post()
  async create(
    @Req() request: { organization: Organization },
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOfferDto
  ) {
    const officer = await this.prisma.user.findUnique({ where: { id: user.id }, select: { fullName: true } });
    return this.offers.create(request.organization, dto, officer?.fullName || request.organization.name);
  }

  @Post(':id/withdraw')
  withdraw(@Req() request: { organization: Organization }, @Param('id') id: string) {
    return this.offers.withdraw(request.organization.id, id);
  }

  /** Accepts JSON or multipart, so a message can carry one file. */
  @Post(':id/messages')
  @UseInterceptors(messageAttachmentInterceptor())
  async message(
    @Req() request: { organization: Organization },
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: OfferMessageDto,
    @UploadedFile() file?: MessageAttachment
  ) {
    const officer = await this.prisma.user.findUnique({ where: { id: user.id }, select: { fullName: true } });
    return this.offers.addOrganizationMessage(
      request.organization.id,
      id,
      dto.body,
      officer?.fullName || request.organization.name,
      file
    );
  }

  @Post(':id/read')
  markRead(@Req() request: { organization: Organization }, @Param('id') id: string) {
    return this.offers.markThreadReadByOrganization(request.organization.id, id);
  }

  /** Polled for the unread badge in the workspace. */
  @Get('messages/unread')
  unread(@Req() request: { organization: Organization }) {
    return this.offers.unreadForOrganization(request.organization.id);
  }

  @Get(':id/messages/:messageId/attachment')
  async attachment(
    @Req() request: { organization: Organization },
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Res() response: Response
  ) {
    const message = await this.offers.attachment(id, messageId, { organizationId: request.organization.id });
    response.setHeader('Content-Type', message.mimeType || 'application/octet-stream');
    response.setHeader('Content-Disposition', `inline; filename="${(message.fileName || 'attachment').replace(/"/g, '')}"`);
    response.sendFile(message.storagePath as string);
  }
}
