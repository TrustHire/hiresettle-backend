import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationType } from '@prisma/client';
import { SlackNotificationsService } from '../modules/notifications/slack-notifications.service';
import { QUEUE_SLACK } from './queues.module';

export interface SlackJobData {
  webhookUrl: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
}

@Processor(QUEUE_SLACK)
export class SlackProcessor extends WorkerHost {
  private readonly logger = new Logger(SlackProcessor.name);

  constructor(private readonly slack: SlackNotificationsService) {
    super();
  }

  async process(job: Job<SlackJobData>): Promise<void> {
    const { webhookUrl, type, title, message, data } = job.data;
    this.logger.log(
      `Posting Slack job ${job.id} (type: ${type}, attempt: ${job.attemptsMade + 1})`,
    );

    await this.slack.send(type, title, message, data, webhookUrl);

    this.logger.log(`Slack job ${job.id} delivered`);
  }
}
