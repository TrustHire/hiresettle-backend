import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MilestonesService } from './milestones.service';

@Injectable()
export class RetentionSchedulerService {
  private readonly logger = new Logger(RetentionSchedulerService.name);
  private isRunning = false;

  constructor(private readonly milestonesService: MilestonesService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleRetentionMilestones() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.logger.log('Executing hourly retention milestones validation check...');

    try {
      const currentLedger = await this.milestonesService.getCurrentLedgerSequence();
      const THREE_DAYS_IN_LEDGERS = 51840; // 1 ledger approx 5 seconds

      const milestones = await this.milestonesService.findActiveRetentionMilestones();

      for (const milestone of milestones) {
        if (currentLedger >= milestone.validAfterLedger) {
          await this.milestonesService.unlockRetentionOnChain(milestone.id);
          this.logger.log(`Automatically unlocked mature milestone ID: ${milestone.id}`);
        } else if (
          milestone.validAfterLedger - currentLedger <= THREE_DAYS_IN_LEDGERS &&
          !milestone.approachingNotificationSent
        ) {
          await this.milestonesService.sendRetentionWarningNotification(milestone.id);
          this.logger.log(`Sent 3-day milestone approach warning notification for ID: ${milestone.id}`);
        }
      }
    } catch (error) {
      this.logger.error('Failed executing scheduled retention check runtime wrapper:', error);
    } finally {
      this.isRunning = false;
    }
  }
}
