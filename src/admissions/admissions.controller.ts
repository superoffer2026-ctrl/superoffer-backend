import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdmissionsService } from './admissions.service';

/** Following up accepted offers, and removing the student once one is confirmed. */
@ApiTags('admin-admissions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/admissions')
export class AdmissionsController {
  constructor(private admissions: AdmissionsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.admissions.list(status);
  }

  @Get(':offerId')
  detail(@Param('offerId') offerId: string) {
    return this.admissions.detail(offerId);
  }

  /** What the team found when they checked with the university. */
  @Patch(':offerId')
  record(
    @Param('offerId') offerId: string,
    @Body() body: { status?: string; note?: string; checkedBy?: string }
  ) {
    return this.admissions.record(offerId, body || {});
  }

  /**
   * Removes the student's personal data. Irreversible, and refused until the
   * admission has been confirmed.
   */
  @Post(':offerId/purge')
  @HttpCode(HttpStatus.OK)
  purge(@Param('offerId') offerId: string, @Body() body: { actor?: string }) {
    return this.admissions.purge(offerId, body?.actor);
  }
}
