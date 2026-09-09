import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ApprovedOrganizationGuard } from '../auth/approved-organization.guard';
import { OffersService } from './offers.service';
import { OrganizationOffersController } from './organization-offers.controller';
import { StudentOffersController } from './student-offers.controller';

@Module({
  imports: [MediaModule],
  controllers: [StudentOffersController, OrganizationOffersController],
  providers: [OffersService, ApprovedOrganizationGuard],
  exports: [OffersService]
})
export class OffersModule {}
