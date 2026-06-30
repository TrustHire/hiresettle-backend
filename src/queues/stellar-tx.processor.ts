import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StellarService } from '../common/stellar/stellar.service';
import { QUEUE_STELLAR_TX } from './queues.module';

export type StellarTxAction = 'release_payment' | 'resolve_dispute' | 'unlock_milestone';

export interface StellarTxJobData {
  action: StellarTxAction;
  engagementId: string;
  milestoneIndex: number;
  approved?: boolean;
}

@Processor(QUEUE_STELLAR_TX)
export class StellarTxProcessor extends WorkerHost {
  private readonly logger = new Logger(StellarTxProcessor.name);

  constructor(private readonly stellar: StellarService) {
    super();
  }

  async process(job: Job<StellarTxJobData>): Promise<void> {
    const { action, engagementId, milestoneIndex, approved } = job.data;
    this.logger.log(`Processing stellar-tx job ${job.id}: ${action} on engagement ${engagementId} milestone ${milestoneIndex} (attempt: ${job.attemptsMade + 1})`);

    switch (action) {
      case 'release_payment':
        await this.stellar.releaseMilestonePayment(engagementId, milestoneIndex);
        break;
      case 'resolve_dispute':
        await this.stellar.resolveMilestoneDispute(engagementId, milestoneIndex, approved ?? false);
        break;
      case 'unlock_milestone':
        await this.stellar.unlockRetentionMilestone(engagementId, milestoneIndex);
        break;
      default:
        throw new Error(`Unknown stellar-tx action: ${action}`);
    }

    this.logger.log(`Stellar-tx job ${job.id} completed: ${action}`);
  }
}
