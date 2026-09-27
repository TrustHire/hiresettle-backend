import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationType } from '@prisma/client';
import { TeamsNotificationsService } from '../modules/notifications/teams-notifications.service';
import { QUEUE_TEAMS } from './queues.module';

export interface TeamsJobData {
  webhookUrl: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
}

@Processor(QUEUE_TEAMS)
export class TeamsProcessor extends WorkerHost {
  private readonly logger = new Logger(TeamsProcessor.name);

  constructor(private readonly teams: TeamsNotificationsService) {
    super();
  }

  async process(job: Job<TeamsJobData>): Promise<void> {
    const { webhookUrl, type, title, message, data } = job.data;
    this.logger.log(
      `Posting Teams job ${job.id} (type: ${type}, attempt: ${job.attemptsMade + 1})`,
    );

    await this.teams.send(type, title, message, data, webhookUrl);

    this.logger.log(`Teams job ${job.id} delivered`);
  }
}
