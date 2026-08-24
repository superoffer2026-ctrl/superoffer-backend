import { Module } from '@nestjs/common';
import { ApprovedOrganizationGuard } from '../auth/approved-organization.guard';
import { DiscoveryService } from './discovery.service';
import { OrganizationsController } from './organizations.controller';
import { OfferTemplatesService } from './offer-templates.service';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [OrganizationsController],
  providers: [DiscoveryService, OrganizationsService, ApprovedOrganizationGuard, OfferTemplatesService],
  exports: [DiscoveryService, OrganizationsService, OfferTemplatesService]
})
export class OrganizationsModule {}
