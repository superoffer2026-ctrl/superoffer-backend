import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { messageAttachmentInterceptor } from './message-attachment';
import type { MessageAttachment } from './offers.service';
import { AuthenticatedUser, CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { OfferDecisionDto, OfferFlagsDto, OfferMessageDto } from './dto/offer.dto';
import { OffersService } from './offers.service';

@ApiTags('student-offers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
@Controller('students/me/offers')
export class StudentOffersController {
  constructor(private offers: OffersService, private prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.offers.listForStudent(user.id);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.OK)
  view(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.offers.markViewed(user.id, id);
  }

  /** Save / favourite / compare — the flags the offer wallet persists. */
  @Patch(':id/flags')
  flags(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: OfferFlagsDto) {
    return this.offers.setFlags(user.id, id, dto);
  }

  @Patch(':id/decision')
  decide(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: OfferDecisionDto) {
    return this.offers.decide(user.id, id, dto.status);
  }

  /** Accepts JSON or multipart, so a message can carry one file. */
  @Post(':id/messages')
  @UseInterceptors(messageAttachmentInterceptor())
  async message(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: OfferMessageDto,
    @UploadedFile() file?: MessageAttachment
  ) {
    const student = await this.prisma.user.findUnique({ where: { id: user.id }, select: { fullName: true } });
    return this.offers.addStudentMessage(user.id, id, dto.body, student?.fullName || 'You', file);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.offers.markThreadReadByStudent(user.id, id);
  }

  /** Polled for the badge in the navigation rail. */
  @Get('messages/unread')
  unread(@CurrentUser() user: AuthenticatedUser) {
    return this.offers.unreadForStudent(user.id);
  }

  @Get(':id/messages/:messageId/attachment')
  async attachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Res() response: Response
  ) {
    const message = await this.offers.attachment(id, messageId, { studentUserId: user.id });
    response.setHeader('Content-Type', message.mimeType || 'application/octet-stream');
    response.setHeader('Content-Disposition', `inline; filename="${(message.fileName || 'attachment').replace(/"/g, '')}"`);
    response.sendFile(message.storagePath as string);
  }
}
