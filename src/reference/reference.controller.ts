import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReferenceService } from './reference.service';

/**
 * Public, read-only dropdown data. Fetched on every wizard step load and it
 * changes rarely, so responses are cached for a day.
 */
/** Nest only supports @Header on route handlers, so it is applied per endpoint. */
const CacheForADay = () => Header('Cache-Control', 'public, max-age=86400');

@ApiTags('reference')
@Controller('reference')
export class ReferenceController {
  constructor(private reference: ReferenceService) {}

  @CacheForADay()
  @Get('geo')
  geo() {
    return this.reference.geo();
  }

  @CacheForADay()
  @Get('study-preferences')
  studyPreferences() {
    return this.reference.studyPreferences();
  }

  @CacheForADay()
  @Get('academic-information')
  academicInformation() {
    return this.reference.academicInformation();
  }

  @CacheForADay()
  @Get('english-exam')
  englishExam() {
    return this.reference.englishExam();
  }

  @CacheForADay()
  @Get('competitive-exam')
  competitiveExam() {
    return this.reference.competitiveExam();
  }

  @CacheForADay()
  @Get('work-experience')
  workExperience() {
    return this.reference.workExperience();
  }

  @CacheForADay()
  @Get('financial-information')
  financialInformation() {
    return this.reference.financialInformation();
  }

  @CacheForADay()
  @Get('projects-achievements')
  projectsAchievements() {
    return this.reference.projectsAchievements();
  }

  @CacheForADay()
  @Get('offer-conditions')
  offerConditions() {
    return this.reference.offerConditions();
  }

  @CacheForADay()
  @Get('documents')
  documents() {
    return this.reference.documents();
  }

  @CacheForADay()
  @Get('organization-options')
  organizationOptions() {
    return this.reference.organizationOptions();
  }
}
