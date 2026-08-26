import {
  Body, Controller, Get, Put, Req, UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { VerificationService } from './verification.service';
import { OrganizationVerificationDto } from './dto/verification.dto';

/**
 * What an organisation supplies to be verified, and how far along it is.
 *
 * Deliberately outside ApprovedOrganizationGuard. Every other organisation
 * route sits behind it, which is right — those routes read student data. This
 * one is the way out of being unapproved, so guarding it the same way would
 * lock the door from the inside.
 */
@ApiTags('organization-verification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('UNIVERSITY_OFFICER', 'LOAN_OFFICER')
@Controller('organizations/me/verification')
export class VerificationController {
  constructor(private verification: VerificationService) {}

  /** Where the submission stands, and precisely what is still outstanding. */
  @Get()
  status(@Req() request: { user: { id: string } }) {
    return this.verification.status(request.user.id);
  }

  @Put()
  save(@Req() request: { user: { id: string } }, @Body() body: OrganizationVerificationDto) {
    return this.verification.save(request.user.id, body);
  }
}
