import { Global, Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { AutomationWorker } from './automation.worker';

/** Global so any service can announce what just happened without extra wiring. */
@Global()
@Module({
  controllers: [AutomationController],
  providers: [AutomationService, AutomationWorker],
  exports: [AutomationService]
})
export class AutomationModule {}
