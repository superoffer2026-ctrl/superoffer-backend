import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import type { AutomationRule } from '@prisma/client';
import { AdminKeyGuard } from '../admin/admin-key.guard';
import { AutomationService } from './automation.service';

/** Authoring the rules that make a thread respond to what happens in it. */
@ApiTags('admin-automation')
@ApiHeader({ name: 'x-admin-key', required: true })
@UseGuards(AdminKeyGuard)
@Controller('admin/automation')
export class AutomationController {
  constructor(private automation: AutomationService) {}

  @Get()
  list() {
    return this.automation.list();
  }

  @Post()
  create(@Body() body: Partial<AutomationRule>) {
    return this.automation.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<AutomationRule>) {
    return this.automation.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.automation.remove(id);
  }

  /** Renders a body against a sample offer so wording can be checked before saving. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() body: { body: string }) {
    return this.automation.preview(body?.body || '');
  }
}
