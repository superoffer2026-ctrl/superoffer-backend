import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
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

  @Get('audit-log')
  auditLog(@Query('limit') limit?: string) {
    return this.admin.auditLog(limit ? Number(limit) : undefined);
  }
}
