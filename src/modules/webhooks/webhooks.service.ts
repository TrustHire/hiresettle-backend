import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import axios from 'axios';
import { signWebhookBody, WEBHOOK_SIGNATURE_HEADER } from './webhook-signing.util';

export interface WebhookPayload {
  event: 'COMPLETED' | 'CANCELLED' | 'REPLACEMENT_REQUESTED' | 'DISPUTE_RAISED' | 'PAYMENT_RELEASED';
  engagementId: string;
  status: string;
  timestamp: string;
}

export interface WebhookDeliveryMeta {
  userId?: string;
  secret?: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Optional() @InjectQueue('webhook') private readonly webhookQueue?: Queue,
  ) {}

  async sendWebhook(url: string, payload: WebhookPayload, meta: WebhookDeliveryMeta = {}): Promise<void> {
    if (!url) return;

    if (this.webhookQueue) {
      await this.webhookQueue.add('send', { url, payload, userId: meta.userId, secret: meta.secret });
      this.logger.log(`Webhook job enqueued for ${url} (event: ${payload.event})`);
      return;
    }

    // Fallback: inline delivery when queue is not available
    this.logger.log(`Delivering webhook inline to ${url} (event: ${payload.event})`);
    try {
      const rawBody = JSON.stringify(payload);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (meta.secret) {
        headers[WEBHOOK_SIGNATURE_HEADER] = signWebhookBody(rawBody, meta.secret);
      }
      await axios.post(url, rawBody, { timeout: 5000, headers });
    } catch (error) {
      this.logger.error(`Inline webhook delivery failed to ${url}: ${error.message}`);
    }
  }
}
