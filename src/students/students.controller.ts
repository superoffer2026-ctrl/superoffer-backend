import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';
import {
  AcademicInformationDto,
  CompetitiveExamDto,
  EnglishExamDto,
  FinancialInformationDto,
  PersonalInformationDto,
  ProjectsAchievementsDto,
  StudyPreferencesDto,
  WorkExperienceDto
} from './dto/student-sections.dto';
import { SchemaValidatorService } from '../forms/schema-validator.service';
import { OffersService } from '../offers/offers.service';
import { StudentsService } from './students.service';

@ApiTags('students')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
@Controller('students/me')
export class StudentsController {
  constructor(
    private students: StudentsService,
    private offers: OffersService,
    private schema: SchemaValidatorService
  ) {}

  @Get()
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.students.getMyProfile(user.id);
  }

  /** Both feeds are derived from real offer activity — there is no separate
   *  notifications or messaging domain. */
  @Get('notifications')
  notifications(@CurrentUser() user: AuthenticatedUser) {
    return this.offers.notificationsForStudent(user.id);
  }

  @Get('messages')
  messages(@CurrentUser() user: AuthenticatedUser) {
    return this.offers.conversationsForStudent(user.id);
  }

  @Delete()
  deleteAccount(@CurrentUser() user: AuthenticatedUser) {
    return this.students.deleteAccount(user.id);
  }

  @Get('completion')
  getCompletion(@CurrentUser() user: AuthenticatedUser) {
    return this.students.completion(user.id);
  }

  // ── The nine-step wizard: one endpoint per section ─────────────────────────

  /**
   * Every section is checked twice: against the DTO, which carries the shape
   * rules the compiler can enforce, and against the published schema, which
   * carries the ones an admin controls.
   *
   * The global pipe whitelists the body down to the DTO, so a field an admin
   * added would be discarded before it could be validated. The raw request body
   * is passed alongside, and the validator merges back exactly the fields the
   * published schema declares — no more.
   */
  @Put('personal-information')
  async savePersonalInformation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PersonalInformationDto,
    @Req() request: { body: Record<string, unknown> }
  ) {
    const payload = await this.schema.mergeAndValidate(
      'personalInformation',
      dto as unknown as Record<string, unknown>,
      request.body,
      'DEFAULT',
      await this.students.storedSection(user.id, 'personalInformation')
    );
    return this.students.savePersonalInformation(user.id, payload as unknown as PersonalInformationDto);
  }

  @Put('study-preferences')
  async saveStudyPreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StudyPreferencesDto,
    @Req() request: { body: Record<string, unknown> }
  ) {
    const payload = await this.schema.mergeAndValidate(
      'studyPreferences',
      dto as unknown as Record<string, unknown>,
      request.body,
      'DEFAULT',
      await this.students.storedSection(user.id, 'studyPreferences')
    );
    return this.students.saveStudyPreferences(user.id, payload as unknown as StudyPreferencesDto);
  }

  @Put('academic-information')
  async saveAcademicInformation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcademicInformationDto,
    @Req() request: { body: Record<string, unknown> }
  ) {
    const payload = await this.schema.mergeAndValidate(
      'academicInformation',
      dto as unknown as Record<string, unknown>,
      request.body,
      'DEFAULT',
      await this.students.storedSection(user.id, 'academicInformation')
    );
    return this.students.saveAcademicInformation(user.id, payload as unknown as AcademicInformationDto);
  }

  @Put('english-exam')
  async saveEnglishExam(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EnglishExamDto,
    @Req() request: { body: Record<string, unknown> }
  ) {
    const payload = await this.schema.mergeAndValidate(
      'englishExam',
      dto as unknown as Record<string, unknown>,
      request.body,
      'DEFAULT',
      await this.students.storedSection(user.id, 'englishExam')
    );
    return this.students.saveEnglishExam(user.id, payload as unknown as EnglishExamDto);
  }

  @Put('competitive-exam')
  async saveCompetitiveExam(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CompetitiveExamDto,
    @Req() request: { body: Record<string, unknown> }
  ) {
    const payload = await this.schema.mergeAndValidate(
      'competitiveExam',
      dto as unknown as Record<string, unknown>,
      request.body,
      'DEFAULT',
      await this.students.storedSection(user.id, 'competitiveExam')
    );
    return this.students.saveCompetitiveExam(user.id, payload as unknown as CompetitiveExamDto);
  }

  @Put('work-experience')
  async saveWorkExperience(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: WorkExperienceDto,
    @Req() request: { body: Record<string, unknown> }
  ) {
    const payload = await this.schema.mergeAndValidate(
      'workExperience',
      dto as unknown as Record<string, unknown>,
      request.body,
      'DEFAULT',
      await this.students.storedSection(user.id, 'workExperience')
    );
    return this.students.saveWorkExperience(user.id, payload as unknown as WorkExperienceDto);
  }

  @Put('financial-information')
  async saveFinancialInformation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: FinancialInformationDto,
    @Req() request: { body: Record<string, unknown> }
  ) {
    const payload = await this.schema.mergeAndValidate(
      'financialInformation',
      dto as unknown as Record<string, unknown>,
      request.body,
      'DEFAULT',
      await this.students.storedSection(user.id, 'financialInformation')
    );
    return this.students.saveFinancialInformation(user.id, payload as unknown as FinancialInformationDto);
  }

  @Put('projects-achievements')
  async saveProjectsAchievements(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ProjectsAchievementsDto,
    @Req() request: { body: Record<string, unknown> }
  ) {
    const payload = await this.schema.mergeAndValidate(
      'projectsAchievements',
      dto as unknown as Record<string, unknown>,
      request.body,
      'DEFAULT',
      await this.students.storedSection(user.id, 'projectsAchievements')
    );
    return this.students.saveProjectsAchievements(user.id, payload as unknown as ProjectsAchievementsDto);
  }

  // ── The older ten-step onboarding flow ────────────────────────────────────

  @Put()
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    return this.students.updateProfile(user.id, body);
  }

  @Put('financial')
  updateFinancial(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    return this.students.updateFinancial(user.id, body);
  }

  @Put('settings')
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    return this.students.updateSettings(user.id, body);
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  submit(@CurrentUser() user: AuthenticatedUser) {
    return this.students.submit(user.id);
  }
}
