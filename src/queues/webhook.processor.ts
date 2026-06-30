import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import axios from 'axios';
import { QUEUE_WEBHOOK } from './queues.module';
import { WebhookPayload } from '../modules/webhooks/webhooks.service';

export interface WebhookJobData {
  url: string;
  payload: WebhookPayload;
}

@Processor(QUEUE_WEBHOOK)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { url, payload } = job.data;
    this.logger.log(`Delivering webhook job ${job.id} to ${url} (event: ${payload.event}, attempt: ${job.attemptsMade + 1})`);

    await axios.post(url, payload, { timeout: 5000 });

    this.logger.log(`Webhook job ${job.id} delivered to ${url}`);
  }
}
