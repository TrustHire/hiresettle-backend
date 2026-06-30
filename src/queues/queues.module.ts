import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailProcessor } from './email.processor';
import { StellarTxProcessor } from './stellar-tx.processor';
import { WebhookProcessor } from './webhook.processor';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { StellarModule } from '../common/stellar/stellar.module';

export const QUEUE_EMAIL = 'email';
export const QUEUE_STELLAR_TX = 'stellar-tx';
export const QUEUE_WEBHOOK = 'webhook';

// Shared retry defaults — imported by any module that registers a queue
export const emailQueueOptions = { name: QUEUE_EMAIL, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } } };
export const stellarTxQueueOptions = { name: QUEUE_STELLAR_TX, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 5000 } } };
export const webhookQueueOptions = { name: QUEUE_WEBHOOK, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } } };

@Module({
  imports: [
    BullModule.registerQueue(emailQueueOptions, stellarTxQueueOptions, webhookQueueOptions),
    NotificationsModule,
    StellarModule,
  ],
  providers: [EmailProcessor, StellarTxProcessor, WebhookProcessor],
})
export class QueuesModule {}
