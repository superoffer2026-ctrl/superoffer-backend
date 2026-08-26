import { Module } from '@nestjs/common';
import { ApprovedOrganizationGuard } from '../auth/approved-organization.guard';
import { DiscoveryService } from './discovery.service';
import { OrganizationsController } from './organizations.controller';
import { OfferTemplatesService } from './offer-templates.service';
import { OrganizationsService } from './organizations.service';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  controllers: [OrganizationsController, VerificationController],
  providers: [DiscoveryService, OrganizationsService, ApprovedOrganizationGuard, OfferTemplatesService, VerificationService],
  exports: [DiscoveryService, OrganizationsService, OfferTemplatesService]
})
export class OrganizationsModule {}
