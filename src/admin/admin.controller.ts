import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { AdminKeyGuard } from './admin-key.guard';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiHeader({ name: 'x-admin-key', required: true })
@UseGuards(AdminKeyGuard)
@Controller('admin')
export class AdminController {
  constructor(private admin: AdminService) {}

  @Get('registrations')
  registrations(@Query('status') status?: string, @Query('org_type') orgType?: string) {
    return this.admin.listRegistrations(status, orgType);
  }

  @Patch('users/:userId/approval')
  review(
    @Param('userId') userId: string,
    @Body() body: { approval_status: string; rejection_reason?: string; approval_note?: string }
  ) {
    return this.admin.reviewRegistration(userId, body.approval_status, body.rejection_reason, body.approval_note);
  }

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('auth-logs')
  authLogs(@Query() query: Record<string, string>) {
    return this.admin.authLogs(query);
  }

  /** Student/organization message threads, for dispute resolution. */
  @Get('conversations')
  conversations(@Query() query: { search?: string; page?: string; pageSize?: string }) {
    return this.admin.conversations(query);
  }

  @Post('conversations/:offerId/access')
  @HttpCode(HttpStatus.OK)
  recordConversationAccess(@Param('offerId') offerId: string, @Body() body: { actor?: string }) {
    return this.admin.recordConversationAccess(offerId, body?.actor || 'super-admin');
  }

  @Get('audit-log')
  auditLog(@Query('limit') limit?: string) {
    return this.admin.auditLog(limit ? Number(limit) : undefined);
  }
}
