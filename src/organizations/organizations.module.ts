import { Module } from '@nestjs/common';
import { ApprovedOrganizationGuard } from '../auth/approved-organization.guard';
import { DiscoveryService } from './discovery.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [OrganizationsController],
  providers: [DiscoveryService, OrganizationsService, ApprovedOrganizationGuard],
  exports: [DiscoveryService, OrganizationsService]
})
export class OrganizationsModule {}
