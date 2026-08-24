import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { AdminKeyGuard } from '../admin/admin-key.guard';
import { FormSchemaDef } from './form-schema.types';
import { FormsService } from './forms.service';

/**
 * The published schema, readable by anyone: the student portal renders from it
 * and it contains no personal data, matching how the rest of `/reference` works.
 */
@ApiTags('forms')
@Controller('reference/form-schema')
export class PublicFormsController {
  constructor(private forms: FormsService) {}

  @Get()
  published(@Query('variant') variant?: string, @Query('form') form?: string) {
    const formKey = this.forms.assertFormKey(form);
    return this.forms.published(variant || 'DEFAULT', formKey);
  }

  @Get('variants')
  variants(@Query('form') form?: string) {
    return this.forms.variants(this.forms.assertFormKey(form));
  }

  /** Which forms exist, so a caller knows what it may ask for. */
  @Get('forms')
  forms_() {
    return { forms: this.forms.forms() };
  }
}

/** Authoring, behind the admin key. */
@ApiTags('admin-forms')
@ApiHeader({ name: 'x-admin-key', required: true })
@UseGuards(AdminKeyGuard)
@Controller('admin/form-schema')
export class AdminFormsController {
  constructor(private forms: FormsService) {}

  /** Which forms exist, with their variants and what each is for. */
  @Get('forms')
  forms_() {
    return { forms: this.forms.forms() };
  }

  @Get()
  list(@Query('variant') variant?: string, @Query('form') form?: string) {
    return this.forms.list(variant || 'DEFAULT', this.forms.assertFormKey(form));
  }

  @Get('variants')
  variants(@Query('form') form?: string) {
    return this.forms.variants(this.forms.assertFormKey(form));
  }

  @Get('health')
  health(@Query('variant') variant?: string, @Query('form') form?: string) {
    return this.forms.health(variant || 'DEFAULT', this.forms.assertFormKey(form));
  }

  @Get('draft')
  draft(@Query('variant') variant?: string, @Query('form') form?: string) {
    return this.forms.draft(variant || 'DEFAULT', this.forms.assertFormKey(form));
  }

  @Put('draft')
  saveDraft(
    @Query('variant') variant: string,
    @Body() body: { definition: FormSchemaDef; label?: string },
    @Query('form') form?: string
  ) {
    return this.forms.saveDraft(variant || 'DEFAULT', body.definition, body.label, this.forms.assertFormKey(form));
  }

  @Post('draft/reset')
  @HttpCode(HttpStatus.OK)
  resetDraft(@Query('variant') variant?: string, @Query('form') form?: string) {
    return this.forms.resetDraft(variant || 'DEFAULT', this.forms.assertFormKey(form));
  }

  /** What publishing would break — always available before publishing. */
  @Get('impact')
  impact(@Query('variant') variant?: string, @Query('form') form?: string) {
    return this.forms.publishImpact(variant || 'DEFAULT', this.forms.assertFormKey(form));
  }

  @Post('publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Query('variant') variant: string,
    @Body() body: { acknowledge?: boolean; actor?: string },
    @Query('form') form?: string
  ) {
    return this.forms.publish(
      variant || 'DEFAULT',
      Boolean(body?.acknowledge),
      body?.actor || 'super-admin',
      this.forms.assertFormKey(form)
    );
  }

  /** Discards every authored version and returns to the built-in form. */
  @Post('reset-to-built-in')
  @HttpCode(HttpStatus.OK)
  resetToBuiltIn(@Query('variant') variant: string, @Body() body: { actor?: string }, @Query('form') form?: string) {
    return this.forms.resetToBuiltIn(variant || 'DEFAULT', body?.actor || 'super-admin', this.forms.assertFormKey(form));
  }

  @Post('restore/:version')
  @HttpCode(HttpStatus.OK)
  restore(@Query('variant') variant: string, @Param('version') version: string, @Query('form') form?: string) {
    return this.forms.restore(variant || 'DEFAULT', Number(version), this.forms.assertFormKey(form));
  }
}
