import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReferenceService } from './reference.service';

/**
 * Public, read-only dropdown data.
 *
 * These lists were once compile-time constants, so holding them in the browser
 * for a day cost nothing — they could not change between deploys. They are
 * editable at runtime now, and a day-long cache meant an admin's edit reached
 * the server, the validator and the published form while the student's own
 * dropdown kept offering yesterday's choices.
 *
 * `no-cache` does not mean "do not store": the browser keeps the copy and
 * revalidates it, so an unchanged list still costs one 304 rather than the
 * whole payload — and a changed one arrives immediately.
 */
/** Nest only supports @Header on route handlers, so it is applied per endpoint. */
const RevalidateEachTime = () => Header('Cache-Control', 'no-cache');

@ApiTags('reference')
@Controller('reference')
export class ReferenceController {
  constructor(private reference: ReferenceService) {}

  @RevalidateEachTime()
  @Get('geo')
  geo() {
    return this.reference.geo();
  }

  @RevalidateEachTime()
  @Get('study-preferences')
  studyPreferences() {
    return this.reference.studyPreferences();
  }

  @RevalidateEachTime()
  @Get('academic-information')
  academicInformation() {
    return this.reference.academicInformation();
  }

  @RevalidateEachTime()
  @Get('english-exam')
  englishExam() {
    return this.reference.englishExam();
  }

  @RevalidateEachTime()
  @Get('competitive-exam')
  competitiveExam() {
    return this.reference.competitiveExam();
  }

  @RevalidateEachTime()
  @Get('work-experience')
  workExperience() {
    return this.reference.workExperience();
  }

  @RevalidateEachTime()
  @Get('financial-information')
  financialInformation() {
    return this.reference.financialInformation();
  }

  @RevalidateEachTime()
  @Get('projects-achievements')
  projectsAchievements() {
    return this.reference.projectsAchievements();
  }

  @RevalidateEachTime()
  @Get('offer-conditions')
  offerConditions() {
    return this.reference.offerConditions();
  }

  @RevalidateEachTime()
  @Get('documents')
  documents() {
    return this.reference.documents();
  }

  @RevalidateEachTime()
  @Get('organization-options')
  organizationOptions() {
    return this.reference.organizationOptions();
  }
}
