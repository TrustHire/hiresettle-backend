import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import axios from 'axios';
import { QUEUE_WEBHOOK } from './queues.module';
import { WebhookPayload } from '../modules/webhooks/webhooks.service';
import { signWebhookBody, WEBHOOK_SIGNATURE_HEADER } from '../modules/webhooks/webhook-signing.util';
import { PrismaService } from '../common/prisma/prisma.service';

export interface WebhookJobData {
  url: string;
  payload: WebhookPayload;
  userId?: string;
  secret?: string;
}

@Processor(QUEUE_WEBHOOK)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { url, payload, secret } = job.data;
    this.logger.log(`Delivering webhook job ${job.id} to ${url} (event: ${payload.event}, attempt: ${job.attemptsMade + 1})`);

    const rawBody = JSON.stringify(payload);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) {
      headers[WEBHOOK_SIGNATURE_HEADER] = signWebhookBody(rawBody, secret);
    }

    await axios.post(url, rawBody, { timeout: 5000, headers });

    this.logger.log(`Webhook job ${job.id} delivered to ${url}`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<WebhookJobData>): Promise<void> {
    const maxAttempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      // more retries are still scheduled on the backoff schedule
      return;
    }

    const { url, payload, userId } = job.data;
    this.logger.error(
      `Webhook job ${job.id} to ${url} exhausted all ${job.attemptsMade} attempts: ${job.failedReason}`,
    );

    await this.prisma.webhookDelivery.create({
      data: {
        userId,
        url,
        event: payload.event,
        payload: payload as any,
        attempts: job.attemptsMade,
        errorMessage: job.failedReason,
      },
    });
  }
}
