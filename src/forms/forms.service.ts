import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { cloneDefaultSchema } from './default-schema';
import { FORM_REGISTRY, FormKey, fallbackVariant, isFormKey } from './form-registry';
import {
  EngineDependency,
  FormFieldDef,
  FormSchemaDef,
  FormSectionDef,
  missingEngineFields
} from './form-schema.types';
import { cloneOrgSchema } from './org-default-schemas';

/** What publishing a draft would change, reported before it happens. */
export interface PublishImpact {
  safe: boolean;
  missing: EngineDependency[];
  removedSections: string[];
  warnings: string[];
}

@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * The schema students see. Falls back to the coded default when nothing has
   * been published yet, so the portal works on a fresh database.
   */
  async published(variant = 'DEFAULT', formKey: FormKey = 'STUDENT_PROFILE'): Promise<FormSchemaDef> {
    const row = await this.prisma.formSchema.findFirst({
      where: { formKey, variant, status: 'PUBLISHED' },
      orderBy: { version: 'desc' }
    });
    if (row) return this.withBuiltInRows(row.definition as unknown as FormSchemaDef, formKey, variant);

    /**
     * This variant's own built-in comes before any fallback. Each organisation
     * type has a real form of its own, and handing a lender the university one
     * would be worse than admitting there is nothing published.
     */
    const own = this.builtIn(formKey, variant);
    if (own) return own;

    /** Only a variant with no built-in of its own inherits the base one. */
    const base = fallbackVariant(formKey);
    if (variant !== base) return this.published(base, formKey);

    throw new NotFoundException({
      code: 'NO_SUCH_FORM',
      message: `No form is published for ${formKey} / ${variant}, and there is no built-in to fall back on`
    });
  }

  /**
   * Fills in structure a stored schema predates.
   *
   * A form authored before repeating blocks carried their rows, before sections
   * had headings, or before an option could be explained, has none of those.
   * Serving it as-is would render an empty block, drop every heading, or lose
   * the line under an option — so the coded ones stand in until an admin edits
   * them. Anything the admin has emptied on purpose — `itemFields: []`, an empty
   * `groups` list — is left exactly as they left it, because it is present.
   */
  private withBuiltInRows(schema: FormSchemaDef, formKey: FormKey, variant: string): FormSchemaDef {
    const builtIn = this.builtIn(formKey, variant);
    if (!builtIn) return schema;

    let filled = 0;
    const sections = schema.sections.map(section => {
      const reference = builtIn.sections.find(candidate => candidate.key === section.key);
      if (!reference) return section;

      const fields = section.fields.map(field => {
        const source = reference.fields.find(candidate => candidate.key === field.key);
        if (!source) return field;

        const patched = { ...field };
        /**
         * `== null` rather than `=== undefined`: a schema published before one
         * of these existed comes back from the JSON column with the key present
         * and null, so a strict undefined check never backfills it.
         */
        if (field.composite && field.itemFields == null && source.itemFields) {
          patched.itemFields = source.itemFields;
          filled++;
        }
        if (field.group == null && source.group) {
          patched.group = source.group;
          filled++;
        }
        if (field.optionHints == null && source.optionHints) {
          patched.optionHints = source.optionHints;
          filled++;
        }
        return patched;
      });

      if (section.groups === undefined && reference.groups) {
        filled++;
        return { ...section, groups: reference.groups, fields };
      }
      return { ...section, fields };
    });

    if (filled) {
      this.logger.log(`Filled ${filled} missing piece(s) of ${formKey}/${variant} from the built-in form`);
    }
    return { ...schema, sections };
  }

  /** The coded form a fresh database serves before anything has been published. */
  /**
   * The schema as it ships. Public because option-set usage is counted from the
   * form that is actually being served, and a form nobody has published yet is
   * still being served — from here.
   */
  builtIn(formKey: FormKey, variant: string): FormSchemaDef | null {
    if (formKey === 'STUDENT_PROFILE') return variant === 'DEFAULT' ? cloneDefaultSchema() : null;
    return cloneOrgSchema(formKey, variant);
  }

  /** Every form an admin can edit, with its variants and what each is for. */
  forms() {
    return Object.values(FORM_REGISTRY).map(descriptor => ({
      key: descriptor.key,
      label: descriptor.label,
      describes: descriptor.describes,
      owner: descriptor.owner,
      variants: descriptor.variants,
      variantsAreFixed: descriptor.variantsAreFixed
    }));
  }

  /** Rejects an unknown form rather than silently editing the student profile. */
  assertFormKey(value: string | undefined): FormKey {
    const key = value || 'STUDENT_PROFILE';
    if (!isFormKey(key)) {
      throw new BadRequestException({ code: 'NO_SUCH_FORM', message: `"${value}" is not a form this admin panel edits` });
    }
    return key;
  }

  /** Every variant an admin has defined, plus the built-in one. */
  async variants(formKey: FormKey = 'STUDENT_PROFILE') {
    const descriptor = FORM_REGISTRY[formKey];
    const rows = await this.prisma.formSchema.findMany({
      where: { formKey },
      distinct: ['variant'],
      select: { variant: true, label: true },
      orderBy: { variant: 'asc' }
    });

    /** The registry variants always appear, so a form nobody has opened is still listed. */
    const known = new Map(descriptor.variants.map(entry => [entry.variant, entry.label]));
    for (const row of rows) known.set(row.variant, row.label);
    return [...known.entries()].map(([variant, label]) => ({ variant, label }));
  }

  async list(variant = 'DEFAULT', formKey: FormKey = 'STUDENT_PROFILE') {
    const versions = await this.prisma.formSchema.findMany({
      where: { formKey, variant },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, label: true, publishedAt: true, updatedAt: true, publishNote: true }
    });
    return { formKey, variant, versions };
  }

  /**
   * The editable draft. Creates one from the currently published schema — or
   * from the coded default — the first time an admin opens the builder.
   */
  async draft(variant = 'DEFAULT', formKey: FormKey = 'STUDENT_PROFILE') {
    const existing = await this.prisma.formSchema.findFirst({
      where: { formKey, variant, status: 'DRAFT' },
      orderBy: { version: 'desc' }
    });
    /** A draft saved before rows existed is filled in too, so the builder can show them. */
    if (existing) {
      return this.present({
        ...existing,
        definition: this.withBuiltInRows(existing.definition as unknown as FormSchemaDef, formKey, variant)
      });
    }

    const base = await this.published(variant, formKey);
    const created = await this.prisma.formSchema.create({
      data: {
        formKey,
        variant,
        version: await this.nextVersion(variant, formKey),
        status: 'DRAFT',
        label: base.label,
        definition: { ...base, variant } as unknown as Prisma.InputJsonValue
      }
    });
    return this.present(created);
  }

  async saveDraft(variant: string, definition: FormSchemaDef, label?: string, formKey: FormKey = 'STUDENT_PROFILE') {
    this.assertWellFormed(definition);
    const draft = await this.prisma.formSchema.findFirst({
      where: { formKey, variant, status: 'DRAFT' },
      orderBy: { version: 'desc' }
    });
    if (!draft) throw new NotFoundException({ code: 'NO_DRAFT', message: 'Open the builder first to start a draft' });

    const updated = await this.prisma.formSchema.update({
      where: { id: draft.id },
      data: {
        label: label ?? draft.label,
        definition: { ...definition, variant } as unknown as Prisma.InputJsonValue
      }
    });
    return this.present(updated);
  }

  /** Discards the draft and starts again from what is live. */
  async resetDraft(variant: string, formKey: FormKey = 'STUDENT_PROFILE') {
    await this.prisma.formSchema.deleteMany({ where: { formKey, variant, status: 'DRAFT' } });
    return this.draft(variant, formKey);
  }

  /**
   * What publishing this draft would break.
   *
   * Removing a field the matching engine reads is allowed — but it is named
   * here, with the filters and scores it powers, so the choice is deliberate
   * rather than discovered later when a filter quietly matches nobody.
   */
  async publishImpact(variant = 'DEFAULT', formKey: FormKey = 'STUDENT_PROFILE'): Promise<PublishImpact> {
    const draft = await this.prisma.formSchema.findFirst({
      where: { formKey, variant, status: 'DRAFT' },
      orderBy: { version: 'desc' }
    });
    if (!draft) throw new NotFoundException({ code: 'NO_DRAFT', message: 'There is no draft to publish' });

    const next = draft.definition as unknown as FormSchemaDef;
    const live = await this.published(variant, formKey);

    /** Each form declares what it cannot do without; the sets are not the same. */
    const missing = missingEngineFields(next, FORM_REGISTRY[formKey].dependencies);
    const removedSections = live.sections
      .filter(section => {
        const after = next.sections.find(candidate => candidate.key === section.key);
        return section.enabled && (!after || !after.enabled);
      })
      .map(section => section.label);

    const warnings: string[] = [];
    for (const dependency of missing) {
      warnings.push(`"${dependency.field}" in ${dependency.section} is gone — this disables: ${dependency.usedBy.join(', ')}.`);
    }
    for (const section of removedSections) {
      const audience = FORM_REGISTRY[formKey].owner === 'student' ? 'students' : 'officers';
      warnings.push(`Section "${section}" will no longer be shown to ${audience}. Existing answers are kept.`);
    }

    return { safe: warnings.length === 0, missing, removedSections, warnings };
  }

  /**
   * Freezes the draft as the live schema. A draft that breaks an engine
   * dependency needs `acknowledge` — the impact is reported first.
   */
  async publish(variant: string, acknowledge: boolean, actor: string, formKey: FormKey = 'STUDENT_PROFILE') {
    const impact = await this.publishImpact(variant, formKey);
    if (!impact.safe && !acknowledge) {
      throw new BadRequestException({
        code: 'PUBLISH_NEEDS_ACKNOWLEDGEMENT',
        message: 'This draft removes fields the product depends on. Review the impact and confirm.',
        warnings: impact.warnings
      });
    }

    const draft = await this.prisma.formSchema.findFirst({
      where: { formKey, variant, status: 'DRAFT' },
      orderBy: { version: 'desc' }
    });
    if (!draft) throw new NotFoundException({ code: 'NO_DRAFT', message: 'There is no draft to publish' });

    await this.prisma.formSchema.updateMany({
      where: { formKey, variant, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' }
    });

    const published = await this.prisma.formSchema.update({
      where: { id: draft.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        publishNote: impact.warnings.length ? impact.warnings.join(' ') : null
      }
    });

    await this.prisma.auditLog.create({
      data: {
        action: 'FORM_SCHEMA_PUBLISHED',
        entityId: published.id,
        actorUserId: actor,
        reason: impact.warnings.length ? `Published with ${impact.warnings.length} warning(s)` : 'Published'
      }
    });

    if (impact.warnings.length) {
      this.logger.warn(`${formKey} ${variant} v${published.version} published with warnings: ${impact.warnings.join(' ')}`);
    }
    return this.present(published);
  }

  /** Rolls back to an earlier version by making a fresh draft from it. */
  async restore(variant: string, version: number, formKey: FormKey = 'STUDENT_PROFILE') {
    const source = await this.prisma.formSchema.findFirst({ where: { formKey, variant, version } });
    if (!source) throw new NotFoundException({ code: 'VERSION_NOT_FOUND', message: 'No such version' });

    await this.prisma.formSchema.deleteMany({ where: { formKey, variant, status: 'DRAFT' } });
    const created = await this.prisma.formSchema.create({
      data: {
        formKey,
        variant,
        version: await this.nextVersion(variant, formKey),
        status: 'DRAFT',
        label: source.label,
        definition: source.definition as Prisma.InputJsonValue
      }
    });
    return this.present(created);
  }

  /**
   * Throws every authored version away, so the API serves the built-in form
   * again. The escape hatch for a schema edited into a corner — and the only way
   * back to a form that is guaranteed to satisfy every engine dependency.
   */
  async resetToBuiltIn(variant: string, actor: string, formKey: FormKey = 'STUDENT_PROFILE') {
    const removed = await this.prisma.formSchema.deleteMany({ where: { formKey, variant } });
    if (removed.count) {
      await this.prisma.auditLog.create({
        data: {
          action: 'FORM_SCHEMA_RESET',
          entityId: `${formKey}:${variant}`,
          actorUserId: actor,
          reason: `Discarded ${removed.count} version(s); reverted to the built-in form`
        }
      });
      this.logger.warn(`${formKey} ${variant} reset to the built-in form (${removed.count} version(s) discarded)`);
    }
    return { reset: true, discarded: removed.count, definition: await this.published(variant, formKey) };
  }

  /** Whether what is live still satisfies every engine dependency. */
  async health(variant = 'DEFAULT', formKey: FormKey = 'STUDENT_PROFILE') {
    const schema = await this.published(variant, formKey);
    const dependencies = FORM_REGISTRY[formKey].dependencies;
    const missing = missingEngineFields(schema, dependencies);
    return {
      formKey,
      variant,
      healthy: missing.length === 0,
      missing,
      checked: dependencies.length
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async nextVersion(variant: string, formKey: FormKey = 'STUDENT_PROFILE') {
    const latest = await this.prisma.formSchema.findFirst({
      where: { formKey, variant },
      orderBy: { version: 'desc' },
      select: { version: true }
    });
    return (latest?.version ?? 0) + 1;
  }

  private present(row: {
    id: string;
    version: number;
    status: string;
    formKey?: string;
    variant: string;
    label: string;
    definition: unknown;
    publishNote?: string | null;
    publishedAt: Date | null;
  }) {
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      formKey: row.formKey || 'STUDENT_PROFILE',
      variant: row.variant,
      /** What the impact check reported when this went live. */
      publishNote: row.publishNote ?? null,
      label: row.label,
      publishedAt: row.publishedAt,
      definition: row.definition as FormSchemaDef
    };
  }

  /** Structural checks an admin cannot talk their way past. */
  private assertWellFormed(schema: FormSchemaDef) {
    if (!schema?.sections?.length) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'A form needs at least one section' });
    }

    const sectionKeys = new Set<string>();
    for (const section of schema.sections) {
      this.assertKey(section.key, 'section');
      if (sectionKeys.has(section.key)) {
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `Duplicate section "${section.key}"` });
      }
      sectionKeys.add(section.key);
      if (!section.label?.trim()) {
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `Section "${section.key}" needs a label` });
      }

      /** A heading a field points at has to exist, or it renders under nothing. */
      const groupKeys = new Set<string>();
      for (const group of section.groups || []) {
        this.assertKey(group.key, 'group');
        if (groupKeys.has(group.key)) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: `Duplicate heading "${group.key}" in ${section.label}`
          });
        }
        groupKeys.add(group.key);
        if (!group.label?.trim()) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: `The heading "${group.key}" in ${section.label} needs a name`
          });
        }
      }

      const fieldKeys = new Set<string>();
      for (const field of section.fields || []) {
        this.assertKey(field.key, 'field');
        if (fieldKeys.has(field.key)) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: `Duplicate field "${field.key}" in ${section.label}`
          });
        }
        fieldKeys.add(field.key);
        this.assertField(field, section.label, (section.fields || []).map(sibling => sibling.key));

        if (field.group && !groupKeys.has(field.group)) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: `"${field.label}" sits under a heading "${field.group}" that ${section.label} does not have`
          });
        }

        /**
         * A composite's rows are checked the same way, against their own siblings:
         * a row condition points at another field in that row, not in the section.
         */
        if (field.itemFields?.length) {
          const rowKeys = new Set<string>();
          const siblings = field.itemFields.map(rowField => rowField.key);
          for (const rowField of field.itemFields) {
            this.assertKey(rowField.key, 'row field');
            if (rowKeys.has(rowField.key)) {
              throw new BadRequestException({
                code: 'VALIDATION_ERROR',
                message: `Duplicate field "${rowField.key}" inside ${field.label}`
              });
            }
            rowKeys.add(rowField.key);
            /**
             * A row also carries whatever identifies it — the qualification level,
             * the exam name — which the row set supplies rather than the admin.
             */
            this.assertField(rowField, field.label, [...siblings, ...ROW_IDENTITY_KEYS]);
          }
        }
      }
    }
  }

  /** The checks every field must pass, whether it sits in a section or a row. */
  private assertField(field: FormFieldDef, within: string, siblingKeys: string[]) {
    if (!field.label?.trim()) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `Field "${field.key}" needs a label` });
    }
    if (field.visibleWhen && !siblingKeys.includes(field.visibleWhen.field)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `"${field.label}" depends on "${field.visibleWhen.field}", which is not in ${within}`
      });
    }
    /** An admin-supplied pattern must compile, or every save would fail later. */
    if (field.validation?.pattern) {
      try {
        new RegExp(field.validation.pattern);
      } catch {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `The pattern on "${field.label}" is not a valid regular expression`
        });
      }
    }
  }

  private assertKey(key: string, what: string) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,48}$/.test(key || '')) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `"${key}" is not a usable ${what} key — use letters, numbers and underscores, starting with a letter`
      });
    }
  }
}

/**
 * Values a row carries without an admin declaring them: what the row set is keyed
 * on. A row condition may point at one of these as well as at a sibling field.
 */
const ROW_IDENTITY_KEYS = ['level', 'exam'];
