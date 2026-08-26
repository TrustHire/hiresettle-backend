import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { NotificationType } from '@prisma/client';
import { QUEUE_EMAIL } from './queues.module';

export interface EmailJobData {
  to: string;
  subject: string;
  message: string;
  type: NotificationType;
  notificationId?: string;
  data?: Record<string, any>;
}

@Processor(QUEUE_EMAIL)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    const { to, subject, message, type, notificationId, data } = job.data;
    this.logger.log(`Sending email job ${job.id} to ${to} (type: ${type}, attempt: ${job.attemptsMade + 1})`);

    await this.notifications.sendEmailDirect(to, subject, message, type, data);

    if (notificationId) {
      await this.notifications.markEmailSent(notificationId);
    }

    this.logger.log(`Email job ${job.id} delivered to ${to}`);
  }
}
