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

  /** Which channels exist, and whether each is actually configured to send. */
  @Get('channels')
  channels() {
    return this.automation.channelStatus();
  }

  /** What a rule has actually done lately, per channel. */
  @Get(':id/deliveries')
  deliveries(@Param('id') id: string) {
    return this.automation.deliveriesFor(id);
  }

  /** Renders a body against a sample offer so wording can be checked before saving. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() body: { body: string }) {
    return this.automation.preview(body?.body || '');
  }

  /**
   * What a condition may read, and which comparisons each field allows.
   *
   * The panel builds its editor from this rather than from a copy of the list,
   * so a field added on the server appears in the admin without a release.
   */
  @Get('fields')
  fields() {
    return this.automation.conditionFields();
  }

  /** Says what a condition means in English, and refuses one that means nothing. */
  @Post('explain')
  @HttpCode(HttpStatus.OK)
  explain(@Body() body: { condition?: unknown }) {
    return this.automation.explainCondition(body?.condition);
  }

  /** What is waiting to be sent, and what was skipped and why. */
  @Get('scheduled')
  scheduled() {
    return this.automation.pending();
  }

  /**
   * Sends whatever is due now instead of waiting for the next tick. The queue
   * is checked once a minute, which is too slow to demonstrate a rule.
   */
  @Post('scheduled/run')
  @HttpCode(HttpStatus.OK)
  runScheduled() {
    return this.automation.dispatchDue();
  }
}
