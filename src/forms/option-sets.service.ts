import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FormsService } from './forms.service';
import { COUNTRIES, INDIA_CITIES, INDIA_STATES } from '../reference/data/geo.data';
import {
  COMPETITIVE_EXAM_OPTIONS, CURRICULUM_OPTIONS, EDUCATION_GAP_OPTIONS, EDUCATION_YEARS,
  ENGLISH_EXAM_OPTIONS, EXAM_STATUS_OPTIONS, FIELDS_OF_STUDY, INTAKE_OPTIONS,
  PROGRAM_LEVELS, START_YEARS, STUDY_COUNTRIES, UNIVERSITY_OPTIONS
} from '../reference/data/master-sheet.data';
import {
  CURRENCY_OPTIONS, EARNING_MEMBER_OPTIONS,
  EMPLOYMENT_TYPES, FUNDING_SOURCE_OPTIONS, QUALIFICATION_OPTIONS
} from '../reference/data/wizard.data';

/**
 * The lists as they shipped, and what to call them in the admin.
 *
 * This is a seed, not the source of truth. Once a row exists the database wins,
 * because an admin's edit must survive the next deploy — a constant that
 * re-asserted itself on restart would silently undo their work.
 */
const SEED: Array<{ key: string; label: string; description: string; values: readonly string[] }> = [
  { key: 'countries', label: 'Countries', description: 'Every country the platform serves', values: COUNTRIES.map(c => c.name) },
  { key: 'dialCodes', label: 'Dial codes', description: 'Country codes for phone numbers', values: COUNTRIES.map(c => c.iso2) },
  { key: 'indiaStates', label: 'Indian states', description: 'States and union territories offered when the country is India', values: INDIA_STATES },
  { key: 'indiaCities', label: 'Indian cities', description: 'Cities offered when the country is India', values: INDIA_CITIES },
  { key: 'studyCountries', label: 'Study destinations', description: 'Where a student may choose to study', values: STUDY_COUNTRIES },
  { key: 'fieldsOfStudy', label: 'Fields of study', description: 'Subjects a student can name', values: FIELDS_OF_STUDY },
  { key: 'studyLevels', label: 'Study levels', description: 'Degree levels a student can pursue', values: PROGRAM_LEVELS },
  { key: 'intakeOptions', label: 'Intakes', description: 'Terms a student can start in', values: INTAKE_OPTIONS },
  { key: 'startYears', label: 'Start years', description: 'Years a student can start in', values: START_YEARS },
  { key: 'qualificationOptions', label: 'Qualification levels', description: 'Levels of education', values: QUALIFICATION_OPTIONS },
  { key: 'curriculumOptions', label: 'Curricula', description: 'School curricula', values: CURRICULUM_OPTIONS },
  { key: 'educationGapOptions', label: 'Education gaps', description: 'How long a break in study lasted', values: EDUCATION_GAP_OPTIONS },
  { key: 'educationYears', label: 'Years of education', description: 'Total years completed', values: EDUCATION_YEARS },
  { key: 'universityOptions', label: 'Universities', description: 'Institutions a student may name', values: UNIVERSITY_OPTIONS },
  { key: 'englishExamOptions', label: 'English exams', description: 'English proficiency tests', values: ENGLISH_EXAM_OPTIONS },
  { key: 'competitiveExamOptions', label: 'Competitive exams', description: 'Standardised tests', values: COMPETITIVE_EXAM_OPTIONS },
  { key: 'examStatusOptions', label: 'Exam statuses', description: 'Where a student is with a test', values: EXAM_STATUS_OPTIONS },
  { key: 'employmentTypes', label: 'Employment types', description: 'How someone is employed', values: EMPLOYMENT_TYPES },
  { key: 'fundingSourceOptions', label: 'Funding sources', description: 'How the studies will be paid for', values: FUNDING_SOURCE_OPTIONS },
  { key: 'earningMemberOptions', label: 'Earning members', description: 'Who in the family earns', values: EARNING_MEMBER_OPTIONS },
  { key: 'currencyOptions', label: 'Currencies', description: 'Currencies an amount can be given in', values: CURRENCY_OPTIONS }
];

@Injectable()
export class OptionSetsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OptionSetsService.name);

  /**
   * Read on every save and every schema render, so it is held in memory rather
   * than queried each time.
   */
  private cache = new Map<string, string[]>();
  private timer?: NodeJS.Timeout;

  /**
   * How long an edit can take to reach an instance that did not make it.
   *
   * Refreshing on write only tells the process that handled the write. Behind
   * more than one replica the others would serve the old list until restart,
   * which is the same staleness bug as an over-long browser cache, one layer
   * down. Re-reading on a timer bounds it without a query per validation.
   */
  private readonly refreshMs = Number(process.env.OPTION_SET_REFRESH_MS || 30_000);

  constructor(private prisma: PrismaService, private forms: FormsService) {}

  async onModuleInit() {
    await this.seed();
    await this.refresh();
    this.timer = setInterval(() => { void this.refresh().catch(() => undefined); }, this.refreshMs);
    /** Never hold the process open on its own account. */
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Adds sets that do not exist yet. Never overwrites one an admin has edited. */
  async seed() {
    const existing = new Set((await this.prisma.optionSet.findMany({ select: { key: true } })).map(row => row.key));
    const missing = SEED.filter(entry => !existing.has(entry.key));
    if (!missing.length) return;

    await this.prisma.optionSet.createMany({
      data: missing.map(entry => ({
        key: entry.key,
        label: entry.label,
        description: entry.description,
        values: [...entry.values],
        system: true
      })),
      skipDuplicates: true
    });
    this.logger.log(`Seeded ${missing.length} option sets`);
  }

  async refresh() {
    const rows = await this.prisma.optionSet.findMany();
    this.cache = new Map(rows.map(row => [row.key, row.values]));
  }

  /** The values a field may offer today. Empty for a key nothing defines. */
  valuesFor(key: string): string[] {
    return this.cache.get(key) ?? [];
  }

  has(key: string) {
    return this.cache.has(key);
  }

  /** Every set, with how many fields point at it. */
  async list() {
    const [sets, published] = await Promise.all([
      this.prisma.optionSet.findMany({ orderBy: { label: 'asc' } }),
      this.prisma.formSchema.findMany({ where: { status: 'PUBLISHED' }, select: { formKey: true, variant: true, definition: true } })
    ]);

    /**
     * A form nobody has edited has no published row, but it is still the form
     * students are filling in — so the built-in stands in for it. Counting only
     * published rows reported that nothing used any list, which is exactly
     * backwards on a fresh installation.
     */
    const publishedKeys = new Set(published.map(row => `${row.formKey}:${row.variant}`));
    const builtIns = this.forms.forms().flatMap(form =>
      form.variants
        .filter(variant => !publishedKeys.has(`${form.key}:${variant.variant}`))
        .map(variant => ({
          formKey: form.key,
          variant: variant.variant,
          definition: this.forms.builtIn(form.key, variant.variant) as unknown
        }))
        .filter(entry => !!entry.definition)
    );

    const schemas = [...published, ...builtIns];

    /** Which published fields name each set, so an admin edits with that in view. */
    const usage = new Map<string, Array<{ form: string; variant: string; field: string }>>();
    for (const schema of schemas) {
      const definition = schema.definition as unknown as {
        sections?: Array<{ fields?: Array<{ key?: string; label?: string; optionsSource?: string; itemFields?: Array<{ key?: string; label?: string; optionsSource?: string }> }> }>;
      };
      for (const section of definition?.sections || []) {
        for (const field of section.fields || []) {
          for (const candidate of [field, ...(field.itemFields || [])]) {
            const source = candidate.optionsSource;
            if (!source?.startsWith('reference:')) continue;
            const key = source.slice('reference:'.length);
            const list = usage.get(key) || [];
            list.push({ form: schema.formKey, variant: schema.variant, field: candidate.label || candidate.key || '' });
            usage.set(key, list);
          }
        }
      }
    }

    return {
      sets: sets.map(set => ({
        key: set.key,
        label: set.label,
        description: set.description,
        values: set.values,
        system: set.system,
        updatedAt: set.updatedAt,
        usedBy: usage.get(set.key) || []
      }))
    };
  }

  private async require(key: string) {
    const set = await this.prisma.optionSet.findUnique({ where: { key } });
    if (!set) throw new NotFoundException({ code: 'OPTION_SET_NOT_FOUND', message: `No option list called "${key}"` });
    return set;
  }

  /**
   * What would break if these values went away.
   *
   * Removing an option must not invalidate a profile that already holds it, so
   * the answer here is a warning rather than a refusal — but an admin should
   * see the number before they decide, not after.
   */
  async impactOf(key: string, nextValues: string[]) {
    const set = await this.require(key);
    const removed = set.values.filter(value => !nextValues.includes(value));
    if (!removed.length) return { removed: [], stillInUse: [] };

    const profiles = await this.prisma.studentProfile.findMany({
      select: {
        personal: true, studyPreferences: true, academic: true,
        entranceExams: true, workExperience: true, financial: true, coApplicant: true
      }
    });

    /** A stored value counts however deeply it sits inside a section. */
    const holds = (blob: unknown, value: string): boolean => {
      if (typeof blob === 'string') return blob === value;
      if (Array.isArray(blob)) return blob.some(entry => holds(entry, value));
      if (blob && typeof blob === 'object') return Object.values(blob).some(entry => holds(entry, value));
      return false;
    };

    const stillInUse = removed.map(value => ({
      value,
      profiles: profiles.filter(profile => Object.values(profile).some(section => holds(section, value))).length
    })).filter(entry => entry.profiles > 0);

    return { removed, stillInUse };
  }

  async update(key: string, input: { label?: string; description?: string; values?: string[] }) {
    const set = await this.require(key);

    const data: Record<string, unknown> = {};
    if (typeof input.label === 'string' && input.label.trim()) data.label = input.label.trim();
    if (typeof input.description === 'string') data.description = input.description.trim();

    if (Array.isArray(input.values)) {
      const cleaned = input.values.map(value => String(value ?? '').trim()).filter(Boolean);
      const seen = new Set<string>();
      const unique = cleaned.filter(value => {
        const lower = value.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
      });
      if (!unique.length) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'A list needs at least one choice — a field pointing at an empty one has nothing to offer'
        });
      }
      data.values = unique;
    }

    const saved = await this.prisma.optionSet.update({ where: { key: set.key }, data });
    await this.refresh();
    return { set: saved };
  }
}
