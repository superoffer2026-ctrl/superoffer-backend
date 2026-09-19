import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BureauCredentialService } from './bureau-credential.service';

/**
 * Partner banks' bureau memberships, behind the admin key.
 *
 * There is deliberately no route that reads a certificate back. The only thing
 * that needs the material is the connector, and it takes it from the secret
 * store directly rather than over HTTP.
 */
@ApiTags('admin-bureau-credentials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/bureau-credentials')
export class BureauCredentialController {
  constructor(private credentials: BureauCredentialService) {}

  @Get()
  list() {
    return this.credentials.list();
  }

  @Put(':organizationId')
  upsert(
    @Param('organizationId') organizationId: string,
    @Body() body: { provider?: string; memberId: string; certificate: string; validFrom?: string; validUntil?: string }
  ) {
    return this.credentials.upsert({ organizationId, ...body, provider: body.provider || 'surepass' });
  }

  @Post(':organizationId/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@Param('organizationId') organizationId: string) {
    return this.credentials.suspend(organizationId);
  }

  @Delete(':organizationId')
  remove(@Param('organizationId') organizationId: string) {
    return this.credentials.remove(organizationId);
  }
}
