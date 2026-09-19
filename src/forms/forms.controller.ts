import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FormSchemaDef } from './form-schema.types';
import { FormsService } from './forms.service';
import { OptionSetsService } from './option-sets.service';

/**
 * The published schema, readable by anyone: the student portal renders from it
 * and it contains no personal data, matching how the rest of `/reference` works.
 */
@ApiTags('forms')
/**
 * The form as students are served it.
 *
 * An admin publishes a change and expects to see it, so the browser revalidates
 * rather than holding a copy. `no-cache` still stores it — an unchanged schema
 * costs one 304 instead of the whole document.
 */
@Controller('reference/form-schema')
export class PublicFormsController {
  constructor(private forms: FormsService) {}

  @Header('Cache-Control', 'no-cache')
  @Get()
  published(@Query('variant') variant?: string, @Query('form') form?: string) {
    const formKey = this.forms.assertFormKey(form);
    return this.forms.published(variant || 'DEFAULT', formKey);
  }

  @Header('Cache-Control', 'no-cache')
  @Get('variants')
  variants(@Query('form') form?: string) {
    return this.forms.variants(this.forms.assertFormKey(form));
  }

  /** Which forms exist, so a caller knows what it may ask for. */
  @Header('Cache-Control', 'no-cache')
  @Get('forms')
  forms_() {
    return { forms: this.forms.forms() };
  }
}

/** Authoring, behind the admin key. */
@ApiTags('admin-forms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/form-schema')
export class AdminFormsController {
  constructor(private forms: FormsService, private optionSets: OptionSetsService) {}

  /** Which forms exist, with their variants and what each is for. */
  @Get('forms')
  forms_() {
    return { forms: this.forms.forms() };
  }

  /**
   * The named lists fields point at, with which fields use each.
   *
   * Editing one changes what every field offers and what the server accepts, so
   * an admin needs to see the reach of a change before making it.
   */
  @Get('option-sets')
  listOptionSets() {
    return this.optionSets.list();
  }

  /** Who would be left holding a value, before it is removed rather than after. */
  @Post('option-sets/:key/impact')
  @HttpCode(HttpStatus.OK)
  optionSetImpact(@Param('key') key: string, @Body() body: { values?: string[] }) {
    return this.optionSets.impactOf(key, Array.isArray(body?.values) ? body.values : []);
  }

  @Patch('option-sets/:key')
  updateOptionSet(
    @Param('key') key: string,
    @Body() body: { label?: string; description?: string; values?: string[] }
  ) {
    return this.optionSets.update(key, body);
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
