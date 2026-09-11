import { Module } from '@nestjs/common';
import { AdminBillingController, OrganizationBillingController } from './billing.controller';
import { BillingService } from './billing.service';

/** Subscriptions sold and settled offline, recorded here and read back online. */
@Module({
  controllers: [OrganizationBillingController, AdminBillingController],
  providers: [BillingService],
  exports: [BillingService]
})
export class BillingModule {}
