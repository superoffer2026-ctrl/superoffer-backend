import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
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

  @Get('offers')
  getOffers(@CurrentUser() user: AuthenticatedUser) {
    return this.students.offers(user.id);
  }

  @Put()
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    return this.students.updateProfile(user.id, body);
  }

  @Put('financial')
  updateFinancial(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    return this.students.updateFinancial(user.id, body);
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  submit(@CurrentUser() user: AuthenticatedUser) {
    return this.students.submit(user.id);
  }
}
