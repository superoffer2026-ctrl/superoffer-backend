import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AutomationService } from './automation.service';

/**
 * Sends the automation that asked to wait.
 *
 * A plain interval rather than a scheduler dependency: the safety that matters
 * is not the timer but the claim, and that lives in the database. Two instances
 * ticking at the same second is fine, because only one of them can move a row
 * out of PENDING.
 *
 * The tick is deliberately coarse. Automation here nudges people about
 * deadlines measured in days, so a minute of imprecision costs nothing and a
 * tight loop would cost a query per second forever.
 */
@Injectable()
export class AutomationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationWorker.name);
  private timer?: NodeJS.Timeout;
  /** Overlapping runs would claim each other's rows and waste the work. */
  private running = false;

  private readonly intervalMs = Number(process.env.AUTOMATION_TICK_MS || 60_000);

  constructor(private automation: AutomationService) {}

  onModuleInit() {
    /** Opt out entirely for tests and for one-off scripts that boot the app. */
    if (process.env.AUTOMATION_WORKER === 'off') {
      this.logger.log('Scheduled automation worker disabled by AUTOMATION_WORKER=off');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    /** Never hold the process open on its own account. */
    this.timer.unref?.();
    this.logger.log(`Scheduled automation worker running every ${Math.round(this.intervalMs / 1000)}s`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const { sent, skipped } = await this.automation.dispatchDue();
      if (sent || skipped) {
        this.logger.log(`Scheduled automation: ${sent} sent, ${skipped} skipped`);
      }
    } catch (error) {
      /** A tick that fails must not stop the ones after it. */
      this.logger.error(`Scheduled automation tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
