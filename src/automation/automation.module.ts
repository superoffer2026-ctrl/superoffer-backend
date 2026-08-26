import { Global, Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { AutomationWorker } from './automation.worker';
import { ChannelRegistry, buildChannelProviders } from './channel.providers';

/** Global so any service can announce what just happened without extra wiring. */
@Global()
@Module({
  controllers: [AutomationController],
  providers: [
    AutomationService,
    AutomationWorker,
    /*
     * Built once from the environment, the same way the login OTP sender is:
     * a configured provider when credentials exist, and a logging one when they
     * do not, so a development machine never posts to a real student.
     */
    { provide: ChannelRegistry, useFactory: () => new ChannelRegistry(buildChannelProviders(process.env)) }
  ],
  exports: [AutomationService]
})
export class AutomationModule {}
