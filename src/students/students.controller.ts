import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';
import { StudentsService } from './students.service';

@ApiTags('students')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
@Controller('students/me')
export class StudentsController {
  constructor(private students: StudentsService) {}

  @Get()
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.students.getMyProfile(user.id);
  }

  @Get('completion')
  getCompletion(@CurrentUser() user: AuthenticatedUser) {
    return this.students.completion(user.id);
  }

  @Put('personal-information')
  updatePersonal(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    return this.students.updateSection(user.id, 'personal', body);
  }

  @Put('academic-information')
  updateAcademic(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    return this.students.updateSection(user.id, 'academic', body);
  }

  @Put('study-preferences')
  updateStudyPreferences(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    return this.students.updateSection(user.id, 'studyPreferences', body);
  }

  @Put('entrance-exams')
  updateEntranceExams(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    return this.students.updateSection(user.id, 'entranceExams', body);
  }

  @Put('financial-information')
  updateFinancial(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    return this.students.updateSection(user.id, 'financial', body);
  }

  @Put('projects-achievements')
  updateProjects(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    return this.students.updateSection(user.id, 'projects', body);
  }

  @Post('submit')
  submit(@CurrentUser() user: AuthenticatedUser) {
    return this.students.submit(user.id);
  }
}
